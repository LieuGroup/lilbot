import { expect, spyOn, test } from 'bun:test'
import { BotService } from '../../server/bots/bot-service'
import { Workspaces } from '../../server/bots/workspaces'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { fakeService } from '../helpers/fake-engine'

const row = (id: string) => ({ id: `row:${id}`, at: 2, order: 0, item: { kind: 'user' as const, text: `hello from ${id}` } })
const dividers = (store: HistoryStore, bot: string) =>
  store.db.query("SELECT id,item FROM history_items WHERE bot=? AND id LIKE 'session:%' ORDER BY id").all(bot) as { id: string; item: string }[]

test('a session without a single message draws no divider; one that has messages does', async () => {
  const f = fakeService()
  // `foreign` is another client's session that stayed empty, found while it was open.
  const source: ConversationSource = {
    list: async () => [
      { id: 'old', at: 1 },
      { id: 'foreign', at: 5 },
      { id: 'later', at: 9 }
    ],
    read: async (id, cursor) => ({ rows: id === 'foreign' || cursor ? [] : [row(id)], cursor: 'end', reset: false, empty: id === 'foreign' || !!cursor }),
    close() {}
  }
  const store = new HistoryStore(f.database)
  const history = new HistoryService(
    store,
    { conversations: async () => source } as unknown as BotEngine,
    async () => [{ id: 'a', engineBotId: 'native' }],
    () => true
  )
  try {
    for (let i = 0; i < 6; i++) await history.tick()
    expect(store.sessions('a').map(s => s.id)).toEqual(['old', 'foreign', 'later'])
    expect(dividers(store, 'a').map(d => d.id)).toEqual(['session:later'])
    store.abandoned('a', 'later')
    expect(dividers(store, 'a').map(d => d.id)).toEqual(['session:later'])
    history.close()
  } finally {
    f.database.close()
  }
})

test('the conversation being opened gets its divider at once, with the reason when it could not be resumed; left empty, it loses it', async () => {
  const f = fakeService()
  const source: ConversationSource = { list: async () => [], read: async () => ({ rows: [], cursor: null, reset: false, empty: true }), close() {} }
  const store = new HistoryStore(f.database)
  const history = new HistoryService(
    store,
    { conversations: async () => source } as unknown as BotEngine,
    async () => [],
    () => true
  )
  const service = new BotService(f.engine, f.store, f.prefs, new Workspaces(f.root), f.memory, { history })
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const first = await service.openChat('b1', undefined, () => {})
    store.write('b1', first.snapshot.chatId, [row('first')])
    // The engine could not resume the main conversation and started another.
    f.stored.delete(first.snapshot.chatId)
    const open = f.engine.openChat
    f.engine.openChat = async (...args) => ({ ...(await open(...args)), resumeRefused: 'engine_not_found' })
    const replaced = await service.openChat('b1', undefined, () => {})
    f.engine.openChat = open
    expect(f.prefs.mainChat('b1')).toBe(replaced.snapshot.chatId)
    expect(warn).toHaveBeenCalledWith('[chat] conversation could not be resumed; started a new session (engine_not_found)')
    expect(dividers(store, 'b1')).toEqual([{ id: `session:${replaced.snapshot.chatId}`, item: JSON.stringify({ kind: 'session', text: 'New session', reason: 'not_resumed' }) }])
    // Oscar starts another session before saying anything in that one: the empty one keeps no divider.
    const fresh = await service.newChat('b1', () => {})
    expect(dividers(store, 'b1').map(d => d.id)).toEqual([`session:${fresh.snapshot.chatId}`])
    expect(JSON.parse(dividers(store, 'b1')[0].item)).toEqual({ kind: 'session', text: 'New session' })
  } finally {
    warn.mockRestore()
    history.close()
    f.database.close()
  }
})
