import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotStore } from '../../server/bots/bot-store'
import { openDatabase } from '../../server/database/database'
import { argsKey, CallingChats } from '../../server/threads/calling-chats'
import { LilBotError } from '../../shared/lilbot-error'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const refusal = (promise: Promise<unknown>) => promise.then(() => null).catch(error => (error instanceof LilBotError ? error.code : String(error)))
const hashNamer = (server: string, tool: string) => `x:${createHash('sha256').update(server).digest('hex').slice(0, 6)}:${tool}`

test('unprefixed engine keeps system, T3, and registered bot-added service tools while dropping built-ins', async () => {
  const services = [{ server: 'lilbot_c_demo', tools: ['echo', 'get-user'] }]
  const calls = new CallingChats(50, { namer: () => (_s, tool) => tool, services: () => services, t3Tools: ['t3_thread_launch'] })
  const since = Date.now()
  calls.saw('b', 'main', 'lilbot_work', { requestId: 'r1' }, 'c1')
  calls.saw('b', 'main', 'echo', { text: 'hi' }, 'c2')
  calls.saw('b', 'main', 't3_thread_launch', { title: 'fix' }, 'c3')
  calls.saw('b', 'shell', 'terminal', { command: 'ls' }, 'c4')
  calls.saw('b', 'shell', 'unregistered_tool', { x: 1 }, 'c5')

  expect(await calls.find('b', 'lilbot_work', 'r1')).toBe('main')
  expect(calls.take('b', 'echo', since, argsKey({ text: 'hi' }), null)).toBe('main')
  expect(calls.take('b', 't3_thread_launch', since, argsKey({ title: 'fix' }), null)).toBe('main')
  expect(calls.starts('b', 'terminal', since)).toEqual([])
  expect(calls.starts('b', 'unregistered_tool', since)).toEqual([])
})

test('opaque hashed-server and suffix engines (no lilbot_ substring) match owned tools and block spoofs', async () => {
  const services = [{ server: 'lilbot_c_demo', tools: ['echo'] }]
  const calls = new CallingChats(50, {
    namer: botId => (botId === 'hashed' ? hashNamer : (server, tool) => `${tool}@${server}`),
    services: () => services,
    t3Tools: ['t3_thread_launch']
  })
  const since = Date.now()

  // Hashed-server engine: zero 'lilbot_' substring in T3 or service tool names.
  const hWork = hashNamer('lilbot_system', 'lilbot_work')
  const hT3 = hashNamer('lilbot_t3', 't3_thread_launch')
  const hSvc = hashNamer('lilbot_c_demo', 'echo')
  const hSpoof = hashNamer('lilbot_c_evil', 'lilbot_work')
  expect(hT3.includes('lilbot_')).toBe(false)
  expect(hSvc.includes('lilbot_')).toBe(false)

  calls.saw('hashed', 'h-main', hWork, { requestId: 'r-h' }, 'h1')
  calls.saw('hashed', 'h-t3', hT3, { title: 't' }, 'h2')
  calls.saw('hashed', 'h-svc', hSvc, { text: 'ok' }, 'h3')
  calls.saw('hashed', 'h-evil', hSpoof, { requestId: 'r-spoof' }, 'h4')
  calls.saw('hashed', 'h-shell', 'terminal', { cmd: 'ls' }, 'h5')

  expect(await calls.find('hashed', 'lilbot_work', 'r-h')).toBe('h-main')
  expect(calls.take('hashed', 't3_thread_launch', since, argsKey({ title: 't' }), null)).toBe('h-t3')
  expect(calls.take('hashed', hSvc, since, argsKey({ text: 'ok' }), null)).toBe('h-svc')
  expect(await refusal(calls.find('hashed', 'lilbot_work', 'r-spoof'))).toBe('session_unknown')
  expect(calls.starts('hashed', 'terminal', since)).toEqual([])

  // Suffix engine (`tool@server`).
  calls.saw('suffix', 's-main', 'lilbot_work@lilbot_system', { requestId: 'r-s' }, 's1')
  calls.saw('suffix', 's-svc', 'echo@lilbot_c_demo', { text: 'yo' }, 's2')
  calls.saw('suffix', 's-evil', 'lilbot_work@lilbot_c_evil', { requestId: 'r-se' }, 's3')
  expect(await calls.find('suffix', 'lilbot_work', 'r-s')).toBe('s-main')
  expect(calls.take('suffix', 'echo@lilbot_c_demo', since, argsKey({ text: 'yo' }), null)).toBe('s-svc')
  expect(await refusal(calls.find('suffix', 'lilbot_work', 'r-se'))).toBe('session_unknown')
})

test('hoisted lookup resolves the bot engine namer once per matcher call regardless of seen size', async () => {
  let namerLookups = 0
  const calls = new CallingChats(60, {
    namer: () => {
      namerLookups++
      return (server, tool) => `eng:${server}:${tool}`
    }
  })
  const since = Date.now()
  for (let i = 0; i < 50; i++) calls.saw('b', `chat-${i}`, 'eng:lilbot_system:lilbot_work', { requestId: `r-${i}` }, `c-${i}`)
  calls.saw('b', 'single-chat', 'eng:lilbot_system:lilbot_about', { a: 1 }, 'c-single')

  namerLookups = 0
  expect(await calls.find('b', 'lilbot_work', 'r-49')).toBe('chat-49')
  expect(namerLookups).toBe(1)

  namerLookups = 0
  expect(calls.take('b', 'lilbot_work', since, argsKey({ requestId: 'r-48' }), 'r-48')).toBe('chat-48')
  expect(namerLookups).toBe(1)

  namerLookups = 0
  expect(calls.takeSingle('b', 'lilbot_about', since, Date.now() + 10)).toBe('single-chat')
  expect(namerLookups).toBe(1)

  namerLookups = 0
  expect(await calls.gate('b', 'lilbot_work', { requestId: 'r-47' })).toBe('chat-47')
  expect(namerLookups).toBe(1)

  namerLookups = 0
  calls.dropClaim('b', 'lilbot_work', 'chat-47')
  expect(namerLookups).toBe(1)

  namerLookups = 0
  expect(calls.starts('b', 'lilbot_work', since)).toHaveLength(50)
  expect(namerLookups).toBe(1)
})

test('BotStore.engineId resolves live bots and returns undefined for missing or deleted bots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-store-engine-id-'))
  const db = openDatabase(join(dir, 'lilbot.db'))
  cleanups.push(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const store = new BotStore(db)
  const bot = {
    id: 'bot-1',
    name: 'One',
    function: '',
    instructions: '',
    model: null,
    isDefault: false,
    reasoningEffort: null,
    permissionMode: 'full-access' as const,
    engineId: 'engine-b',
    engineBotId: 'native-1'
  }
  store.save(bot)
  expect(store.engineId('bot-1')).toBe('engine-b')
  expect(store.engineId('missing')).toBeUndefined()
  store.markDeleted(bot, { files: 'archive', privateMemories: 'keep' })
  expect(store.engineId('bot-1')).toBeUndefined()
})
