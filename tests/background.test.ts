import { expect, spyOn, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { backgroundTask, RetryQueue } from '../server/background'
import { ComputerService } from '../server/computers/computer-service'
import { ComputerStore } from '../server/computers/computer-store'
import { loadServerKey } from '../server/computers/server-key'
import { MemoryReviewer } from '../server/memory/memory-reviewer'
import { RoutineScheduler } from '../server/routines/routine-scheduler'
import { RoutineService } from '../server/routines/routine-service'
import { RoutineStore } from '../server/routines/routine-store'
import { ThreadService } from '../server/threads/thread-service'
import { ThreadStore } from '../server/threads/thread-store'
import { fakeService } from './helpers/fake-engine'

test('timer guard catches synchronous and asynchronous failures and runs the next tick without logging payloads', async () => {
  const log = spyOn(console, 'error').mockImplementation(() => {})
  let calls = 0
  const timer = setInterval(
    backgroundTask('test loop', () => {
      calls++
      if (calls === 1) throw new Error('secret sync payload')
      if (calls === 2) return Promise.reject(new Error('secret async payload'))
    }),
    5
  )
  try {
    for (let n = 0; n < 100 && calls < 3; n++) await Bun.sleep(5)
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(log).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
  } finally {
    clearInterval(timer)
    log.mockRestore()
  }
})

test('routine, review and outbox timers recover after a database read or claim fails', () => {
  const f = fakeService()
  const log = spyOn(console, 'error').mockImplementation(() => {})
  const routines = new RoutineStore(f.database)
  const outbox = new ThreadStore(f.database)
  const scheduler = new RoutineScheduler(new RoutineService(routines, f.service))
  const reviewer = new MemoryReviewer(f.queue, f.engine)
  const threads = new ThreadService(outbox, f.service)
  const computers = new ComputerService(
    new ComputerStore(f.database),
    loadServerKey(f.root),
    () => true,
    () => f.root
  )
  const prunes = spyOn(computers.store, 'prune').mockImplementationOnce(() => {
    throw new Error('database is locked')
  })
  const claims = spyOn(routines, 'claimDue').mockImplementationOnce(() => {
    throw new Error('database is locked')
  })
  const reviews = spyOn(f.queue, 'pending').mockImplementationOnce(() => {
    throw new Error('database is locked')
  })
  const deliveries = spyOn(outbox, 'pending').mockImplementationOnce(() => {
    throw new Error('database is locked')
  })
  try {
    for (const [label, task] of [
      ['computers', () => computers.tick()],
      ['routines', () => scheduler.tick()],
      ['reviews', () => reviewer.tick()],
      ['threads', () => threads.tick()]
    ] as const) {
      const tick = backgroundTask(label, task)
      expect(tick).not.toThrow()
      expect(tick).not.toThrow()
    }
    expect(claims).toHaveBeenCalledTimes(2)
    expect(reviews).toHaveBeenCalledTimes(2)
    expect(deliveries).toHaveBeenCalledTimes(2)
    expect(prunes).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledTimes(4)
  } finally {
    computers.close()
    prunes.mockRestore()
    claims.mockRestore()
    reviews.mockRestore()
    deliveries.mockRestore()
    log.mockRestore()
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('retry queue tracks in-flight items, backs off 30s on transient failures, clears on handled/success, and guards cleanup', async () => {
  let time = 1_000
  const log = spyOn(console, 'error').mockImplementation(() => {})
  const queue = new RetryQueue<string>('sample job', () => time)
  try {
    let seenInFinally = true
    queue.run(
      'a',
      () => {
        throw new Error('sync boom')
      },
      {
        value: 'item-a',
        onFinally: () => {
          seenInFinally = queue.running.has('a')
        }
      }
    )
    expect([queue.ready('a'), queue.running.get('a')]).toEqual([false, 'item-a'])
    await Bun.sleep(5)
    expect([seenInFinally, queue.ready('a')]).toEqual([false, false])
    time += 29_999
    expect(queue.ready('a')).toBe(false)
    time += 1
    expect(queue.ready('a')).toBe(true)
    expect(log).toHaveBeenCalledWith('[background] sample job failed; will retry on the next tick.')

    queue.run('a', () => Promise.reject(new Error('terminal')), { value: 'item-a', onError: () => true })
    await Bun.sleep(5)
    expect([queue.ready('a'), log.mock.calls.length]).toEqual([true, 1])

    queue.run('b', async () => {}, {
      value: 'item-b',
      onFinally: () => {
        throw new Error('cleanup boom')
      }
    })
    await Bun.sleep(5)
    expect(queue.running.has('b')).toBe(false)
    expect(log).toHaveBeenLastCalledWith('[background] sample job cleanup failed; will retry on the next tick.')
  } finally {
    log.mockRestore()
  }
})
