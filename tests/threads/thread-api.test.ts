import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { botCapability } from '../../server/bots/bot-capability'
import { createEngineApi } from '../../server/http/engine-api'
import { MemoryReviewer } from '../../server/memory/memory-reviewer'
import { ThreadService } from '../../server/threads/thread-service'
import { ThreadStore } from '../../server/threads/thread-store'
import { fakeService } from '../helpers/fake-engine'

test('capability selects author, rejects deleted credentials, and excludes persisted thread aliases from review', async () => {
  const f = fakeService()
  try {
    const other = await f.service.createBot({ name: 'Other', function: '', instructions: '' })
    const store = new ThreadStore(f.database)
    const threads = new ThreadService(store, f.service)
    const reviewer = new MemoryReviewer(f.queue, f.engine)
    const handle = createEngineApi(f.memory, 'test', 3371, { bots: f.service, botExists: id => f.store.exists(id), threads, reviewer })
    const call = (path: string, body: object, capability = botCapability('test', 'b1')) =>
      handle(
        new Request(`http://localhost:3371${path}`, {
          method: 'POST',
          headers: { host: 'localhost:3371', authorization: 'Bearer test', 'x-lilbot-bot-capability': capability },
          body: JSON.stringify(body)
        }),
        path
      )
    const input = { botId: other.id, to: other.id, chatId: 'main', text: 'Please calculate 3+4.', requestId: 'one' }
    const result = (await (await call('/engine/threads/ask', input)).json()) as any
    expect(store.get(result.threadId).messages[0].authorId).toBe('b1')
    expect((await call('/engine/threads/ask', input, '')).status).toBe(403)
    for (const alias of ['stored', 'runtime']) store.attach(store.delivery('b1:one')!, other.id, alias, true)
    const reopened = new ThreadStore(f.database)
    const restarted = createEngineApi(f.memory, 'test', 3371, { botExists: () => true, hiddenChat: (_bot, chat) => reopened.isInternal(chat), reviewer })
    for (const chatId of ['stored', 'runtime', 'main'])
      await restarted(
        new Request('http://localhost:3371/engine/memory/turn', {
          method: 'POST',
          headers: { host: 'localhost:3371', authorization: 'Bearer test' },
          body: JSON.stringify({ botId: other.id, chatId, user: 'hi', assistant: 'hello' })
        }),
        '/engine/memory/turn'
      )
    expect(f.queue.take(other.id, 10).map(t => t.chatId)).toEqual(['main'])
    f.store.markDeleted(f.store.get('b1'), { files: 'delete', privateMemories: 'forget' })
    expect((await call('/engine/threads/ask', input)).status).toBe(403)
    expect((await threads.open(other.id, result.threadId)).messages[0].authorId).toBe('b1')
  } finally {
    f.activity.close()
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('main snapshots include one reference; unrelated explicit history does not acquire it', async () => {
  const f = fakeService()
  try {
    const other = await f.service.createBot({ name: 'Other', function: '', instructions: '' })
    const store = new ThreadStore(f.database)
    const threads = new ThreadService(store, f.service)
    await threads.ask('b1', { to: other.id, requestId: 'one', chatId: 'main', text: 'Please calculate 7+8.' })
    const { BrowserSession } = await import('../../server/http/browser-session')
    const frames: any[] = []
    const browser = new BrowserSession(f.service, frame => frames.push(frame), undefined, undefined, undefined, threads)
    await browser.handle(JSON.stringify({ id: 1, method: 'chat.open', params: { botId: 'b1' } }))
    expect(frames.find(frame => frame.id === 1).result.items.filter((i: any) => i.threadId)).toHaveLength(1)
    f.stored.add('older-chat')
    await browser.handle(JSON.stringify({ id: 2, method: 'chat.open', params: { botId: 'b1', chatId: 'older-chat' } }))
    expect(frames.find(frame => frame.id === 2).result.items.filter((i: any) => i.threadId)).toHaveLength(0)
    browser.close()
  } finally {
    f.activity.close()
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})
