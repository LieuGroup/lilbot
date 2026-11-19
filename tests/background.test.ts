import { expect, spyOn, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { backgroundTask } from '../server/background'
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
