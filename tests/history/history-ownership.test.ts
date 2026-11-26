import { expect, test } from 'bun:test'
import { chatKinds, hiddenChats } from '../../server/bots/hidden-chats'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { excludeSession } from '../../server/history/history-exclusion'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'

const row = (id: string, at: number, text: string) => ({ id, at, order: at, item: { kind: 'user' as const, text } })

/** A bot whose engine holds its pre-LilBot chat `before`, LilBot's own main `main`, `phone`, a chat the owner started in
 *  the engine's own app after LilBot met the bot (continued after compression as `phone-2`), and a session with no start. */
function world(start: number) {
  const db = openDatabase(':memory:')
  const store = new HistoryStore(db)
  const listed = [
    { id: 'before', at: start - 60_000 },
    { id: 'phone', at: start + 5_000 },
    { id: 'unknown-start', at: 0 }
  ]
  const source: ConversationSource = {
    list: async () => listed,
    read: async (id, cursor) => ({ rows: cursor ? [] : [row(`hermes:p:${id}`, start + 1, `${id} text`)], cursor: 'end', reset: false, empty: !!cursor }),
    close() {}
  }
  const roots: Record<string, string> = { 'phone-2': 'phone', 'main-2': 'main' }
  const kind = chatKinds(
    (_bot, chat) => roots[chat] ?? chat,
    () => false,
    (bot, chat) => store.owned.owns(bot, chat)
  )
  const hidden = hiddenChats(kind)
  const service = new HistoryService(
    store,
    { conversations: async () => source } as unknown as BotEngine,
    async () => [{ id: 'a', engineBotId: 'p' }],
    (_bot, session) => session === '' || !hidden('a', session)
  )
  return { db, store, listed, service, kind }
}

test('only sessions LilBot opened, had before it met the bot, or continues are recorded; an outside chat never is', async () => {
  const start = Date.now()
  const { db, store, listed, service, kind } = world(start)
  try {
    store.owned.own('a', 'main')
    await service.tick()
    // A chat the owner starts in the engine's own app later is outside too.
    listed.push({ id: 'phone-later', at: Date.now() + 1000 })
    ;(service as unknown as { sources: Map<string, { listed: number }> }).sources.get('a')!.listed = 0
    await service.tick()
    for (let i = 0; i < 6; i++) await service.tick()
    expect(store.sessions('a').map(s => s.id)).toEqual(['before'])
    expect(['before', 'main', 'main-2', 'phone', 'phone-2', 'phone-later', 'unknown-start'].map(chat => kind('a', chat))).toEqual([
      'conversation',
      'conversation',
      'conversation',
      'outside',
      'outside',
      'outside',
      'outside'
    ])
    // The live journal and the observer drop an outside session's events, so nothing about it reaches the record.
    service.record('a', 'phone', { type: 'user.message', messageId: 'x', text: 'from the engine app', attachments: [], images: { support: 'unknown', imageCount: 0 } })
    service.record('a', 'phone-2', { type: 'turn.finished', status: 'completed', text: 'reply' })
    expect((db.query("SELECT count(*) n FROM history_events WHERE session LIKE 'phone%'").get() as { n: number }).n).toBe(0)
    expect(store.page('a', undefined, 50, 'main').items.some(item => item.sessionId.startsWith('phone'))).toBe(false)
    expect(store.search('a', 'phone')).toEqual([])
  } finally {
    service.close()
    db.close()
  }
})

test('an excluded session is never the conversation again, even one LilBot opened', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new HistoryStore(db)
    store.owned.own('a', 'old')
    store.owned.own('a', 'main')
    db.query("INSERT INTO bot_prefs(bot_id, main_chat_id) VALUES('a','main')").run()
    store.session('a', 'old', 1)
    store.write('a', 'old', [row('r', 1, 'old')])
    const kind = chatKinds(
      (_b, chat) => chat,
      () => false,
      (bot, chat) => store.owned.owns(bot, chat)
    )
    expect(kind('a', 'old')).toBe('conversation')
    excludeSession(db, 'a', 'old', 'test')
    expect(kind('a', 'old')).toBe('outside')
    store.owned.own('a', 'old')
    expect(kind('a', 'old')).toBe('outside')
  } finally {
    db.close()
  }
})

test('upgrading keeps every session already recorded and the main one; nothing else is adopted afterwards', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new HistoryStore(db)
    expect(store.owned.owns('a', 'x')).toBe(false)
    db.exec(`DELETE FROM history_owned; DELETE FROM history_adoption;
      INSERT INTO history_sessions(bot,id,at) VALUES('a','imported',5),('a','gone',6);
      INSERT INTO history_exclusions VALUES('a','gone','test',1);
      INSERT INTO history_imports VALUES('a');
      INSERT INTO bot_prefs(bot_id, main_chat_id) VALUES('a','main')`)
    const { migrations } = require('../../server/database/migrations') as typeof import('../../server/database/migrations')
    db.exec(migrations.at(-1)!)
    expect(['imported', 'main', 'gone'].map(s => store.owned.owns('a', s))).toEqual([true, true, false])
    store.owned.adoptEarlier('a', [{ id: 'phone', at: 1 }])
    expect(store.owned.owns('a', 'phone')).toBe(false)
  } finally {
    db.close()
  }
})

test("switching the bot's engine makes the new engine's session part of the conversation", async () => {
  const db = openDatabase(':memory:')
  const store = new HistoryStore(db)
  const source: ConversationSource = { list: async () => [], read: async () => ({ rows: [], cursor: null, reset: false, empty: true }), close() {} }
  const history = new HistoryService(
    store,
    { id: 'old', conversations: async () => source } as unknown as BotEngine,
    async () => [],
    () => true
  )
  try {
    store.owned.own('b1', 'old-main')
    const prepared = await history.prepareEngineSwitch({ id: 'b1', engineId: 'old', engineBotId: 'n1' })
    expect(store.owned.owns('b1', 'new-main')).toBe(false)
    prepared.commit('new-main')
    expect(store.owned.owns('b1', 'new-main')).toBe(true)
  } finally {
    history.close()
    db.close()
  }
})
