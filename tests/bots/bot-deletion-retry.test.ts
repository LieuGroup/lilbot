/** Bounded background retries for incomplete bot-deletion tombstones. */
import { afterEach, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { detail, fakeEngine, nativeBotId } from '../helpers/fake-engine'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function setup(retryDelayMs = 25) {
  const fake = fakeEngine()
  const database = openDatabase(':memory:')
  const store = new BotStore(database)
  store.import('test', [{ ...detail, engineId: 'test', engineBotId: nativeBotId }])
  const prefs = new BotPrefsStore(database)
  const memory = new MemoryService(new MemoryStore(database))
  const root = mkdtempSync(join(tmpdir(), 'lilbot-del-retry-'))
  dirs.push(root)
  const service = new BotService(fake.engine, store, prefs, new Workspaces(root), memory, {
    deletionRetry: { retryDelayMs }
  })
  return { ...fake, database, store, prefs, memory, root, service }
}

test('resumeIncompleteDeletions does nothing and leaves zero timers when there are no incomplete tombstones', () => {
  const f = setup(25)
  const realSetTimeout = globalThis.setTimeout
  let timers = 0
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    timers++
    return realSetTimeout(...args)
  }) as typeof setTimeout
  let stop: (() => void) | undefined
  try {
    stop = f.service.resumeIncompleteDeletions()
    expect(timers).toBe(0)
    expect(f.store.list().map(b => b.id)).toEqual(['b1'])
  } finally {
    stop?.()
    globalThis.setTimeout = realSetTimeout
  }
})

test('prepareRuntimes does not run or block on incomplete tombstones', async () => {
  const f = setup(25)
  const doomed = await f.service.createBot({ name: 'Doomed', function: '', instructions: '' })
  f.store.markDeleted(f.store.get(doomed.id), { files: 'delete', privateMemories: 'forget' }, false)
  let deleteCalls = 0
  f.engine.deleteRuntime = async () => {
    deleteCalls++
    await new Promise(() => {})
  }
  await f.service.prepareRuntimes()
  expect(deleteCalls).toBe(0)
  expect(f.store.deleted(doomed.id)?.complete).toBe(false)
})

test('startup tombstone retries with backoff, logs only fixed label, preserves saved choices, and stops timer once complete', async () => {
  const f = setup(35)
  const log = spyOn(console, 'error').mockImplementation(() => {})
  let stop: (() => void) | undefined
  try {
    const doomed = await f.service.createBot({ name: 'Doomed', function: '', instructions: '' })
    await mkdir(join(f.root, doomed.id), { recursive: true })
    await writeFile(join(f.root, doomed.id, 'note'), 'remove me')
    const own = f.memory.write({ botId: doomed.id, kind: 'journal', text: 'Keep this private memory.', author: 'user' })
    f.store.markDeleted(f.store.get(doomed.id), { files: 'delete', privateMemories: 'keep' }, false)

    let online = false
    let attempts = 0
    f.engine.deleteRuntime = async () => {
      attempts++
      if (!online) throw new Error('secret-token-should-never-be-logged')
    }

    stop = f.service.resumeIncompleteDeletions()
    await Bun.sleep(15)
    // Backoff prevents tight-looping within the retry window.
    expect(attempts).toBe(1)
    expect(f.store.deleted(doomed.id)?.complete).toBe(false)
    expect(log).toHaveBeenCalledWith('[background] bot deletion failed; will retry on the next tick.')
    for (const call of log.mock.calls) expect(call.join(' ')).not.toContain('secret-token')

    online = true
    for (let i = 0; i < 30 && !f.store.deleted(doomed.id)?.complete; i++) await Bun.sleep(15)
    expect(f.store.deleted(doomed.id)?.complete).toBe(true)
    expect(existsSync(join(f.root, doomed.id))).toBe(false)
    expect(existsSync(join(f.root, '.archive', doomed.id))).toBe(false)
    expect((await f.service.listMemory(doomed.id)).facts.some(x => x.id === own.id)).toBe(true)
    expect((await f.service.listBots()).map(b => b.id)).toEqual(['b1'])

    const attemptsAtDone = attempts
    await Bun.sleep(80)
    expect(attempts).toBe(attemptsAtDone)
  } finally {
    stop?.()
    log.mockRestore()
  }
})

test('runtime transient delete failure also recovers via background retry once engine returns', async () => {
  const f = setup(30)
  const log = spyOn(console, 'error').mockImplementation(() => {})
  const stop = f.service.resumeIncompleteDeletions()
  try {
    const doomed = await f.service.createBot({ name: 'Runtime Fail', function: '', instructions: '' })
    let online = false
    f.engine.deleteRuntime = async () => {
      if (!online) throw new Error('offline')
    }
    await expect(f.service.deleteBot({ botId: doomed.id, files: 'delete', privateMemories: 'forget' })).rejects.toThrow('offline')
    expect(f.store.deleted(doomed.id)?.complete).toBe(false)

    online = true
    for (let i = 0; i < 30 && !f.store.deleted(doomed.id)?.complete; i++) await Bun.sleep(15)
    expect(f.store.deleted(doomed.id)?.complete).toBe(true)
  } finally {
    stop()
    log.mockRestore()
  }
})
