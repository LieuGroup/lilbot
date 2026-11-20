import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachmentService } from '../../server/attachments/attachment-service'
import { AttachmentStore } from '../../server/attachments/attachment-store'
import type { BotEngine, ConversationSource, OpenChat } from '../../server/engines/bot-engine'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { BrowserSession } from '../../server/http/browser-session'
import type { ChatItem } from '../../shared/chat-schema'
import { DEVICE_A, DEVICE_B, deviceFixture } from './device-fixture'

const closers: (() => void)[] = []
afterEach(() => {
  for (const close of closers.splice(0)) close()
})
const NOW = 1_000_000_000_000

const user = (n: number, text: string, at = NOW + n * 1000) => ({ id: `hermes:p:${n}`, at, order: n, item: { kind: 'user', text } as ChatItem })
function importer(d: ReturnType<typeof deviceFixture>, rows: () => ReturnType<typeof user>[]) {
  const source: ConversationSource = { list: async () => [{ id: 's1', at: NOW }], read: async () => ({ rows: rows(), cursor: 'c', reset: false, empty: false }), close() {} }
  const store = new HistoryStore(d.db)
  const service = new HistoryService(
    store,
    { conversations: async () => source } as unknown as BotEngine,
    async () => [{ id: 'bot', engineBotId: 'native' }],
    () => true,
    (botId, _session, imported) => d.devices.mergeRows(botId, imported)
  )
  return { store, tick: () => service.tick() }
}
const origins = (store: HistoryStore) => store.page('bot', undefined, 100).items.map(row => (row.item.kind === 'user' ? (row.item.origin?.name ?? null) : undefined))
async function sendFrom(d: ReturnType<typeof deviceFixture>, deviceId: string, text: string, at: number) {
  d.now.value = at
  const chat = { snapshot: { botId: 'bot', chatId: 's1' }, send: async () => {} } as unknown as OpenChat
  await d.devices.send(chat, text, crypto.randomUUID(), d.devices.origin(deviceId))
}

test('history rows get the device their message was sent from: in order, once, and the same after the page is read again', async () => {
  const d = deviceFixture({ value: NOW })
  closers.push(d.close)
  d.devices.current(DEVICE_A, 'MacBook')
  d.devices.current(DEVICE_B, 'iPhone')
  await sendFrom(d, DEVICE_B, 'yes', NOW + 1000)
  await sendFrom(d, DEVICE_A, 'yes', NOW + 2000)
  await sendFrom(d, DEVICE_A, 'ship it', NOW + 3000)
  const { store, tick } = importer(d, () => [user(0, 'yes', NOW - 99_000), user(1, 'yes'), user(2, 'yes'), user(3, 'ship it'), user(4, 'yes', NOW + 9000)])
  await tick()
  // The older "yes" (before any send), the later "yes" (no send waiting) and anything not sent here have no device.
  expect(origins(store)).toEqual([null, 'iPhone', 'MacBook', 'MacBook', null])
  await tick()
  expect(origins(store)).toEqual([null, 'iPhone', 'MacBook', 'MacBook', null])
  d.devices.rename(DEVICE_B, 'Renamed phone')
  await tick()
  expect(origins(store)).toEqual([null, 'iPhone', 'MacBook', 'MacBook', null])
})

test('a waiting message only matches a row of its own bot and text, and gives up after six hours', async () => {
  const d = deviceFixture({ value: NOW })
  closers.push(d.close)
  d.devices.current(DEVICE_A, 'MacBook')
  await sendFrom(d, DEVICE_A, 'hello', NOW)
  const rows = [user(1, 'hello there'), user(2, 'Hello')]
  expect(d.devices.mergeRows('other-bot', [user(3, 'hello')]).map(row => (row.item as { origin?: unknown }).origin)).toEqual([undefined])
  expect(d.devices.mergeRows('bot', rows).map(row => (row.item as { origin?: unknown }).origin)).toEqual([undefined, undefined])
  expect((d.devices.mergeRows('bot', [user(4, 'hello', NOW + 7 * 3_600_000)])[0].item as { origin?: unknown }).origin).toBeUndefined()
  expect((d.devices.mergeRows('bot', [user(5, 'hello', NOW + 2000)])[0].item as { origin?: { name: string } }).origin?.name).toBe('MacBook')
})

test('deleting a bot forgets what was waiting for it', async () => {
  const d = deviceFixture({ value: NOW })
  closers.push(d.close)
  d.devices.current(DEVICE_A, 'MacBook')
  await sendFrom(d, DEVICE_A, 'hello', NOW)
  d.devices.forgetBot('bot')
  expect(d.devices.mergeRows('bot', [user(1, 'hello')])[0].item).toEqual({ kind: 'user', text: 'hello' })
})

test('a message with files keeps its device in its own record, which snapshots and history rows read back', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-origin-files-'))
  const d = deviceFixture({ value: NOW })
  closers.push(() => {
    d.close()
    rmSync(root, { recursive: true, force: true })
  })
  d.devices.current(DEVICE_A, 'MacBook')
  const events: unknown[] = []
  const service = new AttachmentService(
    new AttachmentStore(d.db),
    () => root,
    id => id === 'bot',
    (...args) => events.push(args)
  )
  const [file] = service.prepare('bot', [{ name: 'notes.txt', size: 2, mime: 'text/plain' }])
  await service.upload('bot', file.id, new Request('http://localhost/x', { method: 'PUT', body: 'hi' }))
  const sent: { text: string; options: Parameters<OpenChat['send']>[1] }[] = []
  const chat = {
    snapshot: { botId: 'bot', chatId: 's1' },
    send: async (text: string, options: Parameters<OpenChat['send']>[1]) => void sent.push({ text, options })
  } as unknown as OpenChat
  const messageId = crypto.randomUUID()
  const message = await service.send(chat, 'see the file', [file.id], messageId, d.devices.origin(DEVICE_A))
  expect(message.origin).toEqual({ deviceId: DEVICE_A, name: 'MacBook' })
  expect(sent[0].options?.origin?.line).toContain('"MacBook"')
  expect(sent[0].text).toContain(`[LilBot attachment message ${messageId}]`)
  expect(events).toHaveLength(1)
  d.devices.rename(DEVICE_A, 'Renamed')
  const row = { id: 'hermes:p:1', at: NOW, order: 1, item: { kind: 'user', text: sent[0].text } as ChatItem }
  const merged = service.merge({ botId: 'bot', chatId: 's1', title: '', workspace: '', running: false, items: [row.item] })
  expect(merged.items[0]).toMatchObject({ kind: 'user', text: 'see the file', messageId, origin: { deviceId: DEVICE_A, name: 'MacBook' } })
  expect(d.devices.mergeRows('bot', [{ ...row, item: merged.items[0] }])[0].item).toMatchObject({ origin: { name: 'MacBook' } })
})

test('chat.history pages and the opened snapshot both carry the device of each stored message', async () => {
  const d = deviceFixture({ value: NOW })
  closers.push(d.close)
  d.devices.current(DEVICE_B, 'iPhone')
  await sendFrom(d, DEVICE_B, 'from my phone', NOW + 1000)
  const { store, tick } = importer(d, () => [user(1, 'older, from before devices', NOW - 5000), user(2, 'from my phone')])
  await tick()
  const bots = {
    historyPage: async (botId: string, cursor?: string, limit?: number) => store.page(botId, cursor, limit),
    isMainChat: () => true,
    openChat: async (botId: string) => ({
      snapshot: { chatId: 's1', botId, title: '', running: false, workspace: '', items: [] },
      send: async () => {},
      stop: async () => {},
      close() {}
    })
  }
  const frames: any[] = []
  const browser = new BrowserSession(bots as never, frame => frames.push(frame))
  await browser.handle(JSON.stringify({ id: 1, method: 'chat.history', params: { botId: 'bot' } }))
  await browser.handle(JSON.stringify({ id: 2, method: 'chat.open', params: { botId: 'bot' } }))
  const names = (items: { item?: ChatItem; kind?: string; origin?: { name: string } }[]) =>
    items.map(entry => (entry.item ?? entry) as { origin?: { name: string } }).map(item => item.origin?.name ?? null)
  expect(names(frames[0].result.items)).toEqual([null, 'iPhone'])
  expect(names(frames[1].result.history.items)).toEqual([null, 'iPhone'])
  expect(names(frames[1].result.items)).toEqual([null, 'iPhone'])
})
