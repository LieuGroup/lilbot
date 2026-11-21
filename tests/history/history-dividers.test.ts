import { expect, spyOn, test } from 'bun:test'
import { BotService } from '../../server/bots/bot-service'
import { Workspaces } from '../../server/bots/workspaces'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { fakeService } from '../helpers/fake-engine'

const said = (id: string, at: number) => ({ id: `row:${id}`, at, order: 0, item: { kind: 'user' as const, text: `hello from ${id}` } })
const tool = { id: 'row:tool', at: 6, order: 0, item: { kind: 'tool' as const, toolId: 'tool', name: 'terminal', detail: '', running: false } }
const shown = (store: HistoryStore, main?: string, limit?: number) => {
  const ids: string[] = []
  for (let cursor: string | undefined, more = true; more; ) {
    const page = store.page('a', cursor, limit, main)
    ids.unshift(...page.items.map(row => row.id))
    cursor = page.nextCursor ?? undefined
    more = !!cursor
  }
  return ids
}

test('an empty session between two real ones shows no divider, stored or re-imported; one with messages keeps its own', async () => {
  const f = fakeService()
  const rows: Record<string, ReturnType<typeof said>[]> = { old: [said('old', 2)], empty: [tool as never], later: [said('later', 10)] }
  const source: ConversationSource = {
    list: async () => [
      { id: 'old', at: 1 },
      { id: 'empty', at: 5 },
      { id: 'later', at: 9 }
    ],
    read: async (id, cursor) => ({ rows: cursor ? [] : rows[id], cursor: cursor ? null : 'end', reset: false, empty: !!cursor }),
    close() {}
  }
  const store = new HistoryStore(f.database)
  const history = () =>
    new HistoryService(
      store,
      { conversations: async () => source } as unknown as BotEngine,
      async () => [{ id: 'a', engineBotId: 'native' }],
      () => true
    )
  try {
    // As existing history holds it: a divider was stored for every session after the first, the empty one included.
    const first = history()
    for (let i = 0; i < 6; i++) await first.tick()
    first.close()
    expect(store.db.query("SELECT id FROM history_items WHERE id LIKE 'session:%' ORDER BY id").all()).toEqual([{ id: 'session:empty' }, { id: 'session:later' }])
    const expected = ['row:old', 'row:tool', 'session:later', 'row:later']
    expect(shown(store)).toEqual(expected)
    expect(shown(store, undefined, 1)).toEqual(expected)
    // A re-import reads every session again and draws its dividers again: the page still leaves the empty one out.
    store.db.query('UPDATE history_sessions SET cursor=NULL, complete=0').run()
    const again = history()
    for (let i = 0; i < 6; i++) await again.tick()
    again.close()
    expect(shown(store)).toEqual(expected)
    // The main session's divider shows while it is still empty: Oscar has just started it.
    expect(shown(store, 'empty')).toEqual(['row:old', 'session:empty', 'row:tool', 'session:later', 'row:later'])
    // A reason given while opening replaces the plain divider discovery may have drawn a moment earlier.
    store.divider('a', 'later', 9, 'not_resumed')
    expect(store.page('a').items.find(row => row.id === 'session:later')?.item).toEqual({ kind: 'session', text: 'New session', reason: 'not_resumed' })
  } finally {
    f.database.close()
  }
})

test('a conversation the engine could not resume gets a divider that says so, hidden again once it is left empty', async () => {
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
  const dividers = async () => (await service.historyPage('b1')).items.filter(row => row.item.kind === 'session').map(row => ({ id: row.id, item: row.item }))
  try {
    const first = await service.openChat('b1', undefined, () => {})
    store.write('b1', first.snapshot.chatId, [said('first', 2)])
    // The engine could not resume the main conversation and started another.
    f.stored.delete(first.snapshot.chatId)
    const open = f.engine.openChat
    f.engine.openChat = async (...args) => ({ ...(await open(...args)), resumeRefused: 'engine_not_found' })
    const replaced = await service.openChat('b1', undefined, () => {})
    f.engine.openChat = open
    expect(f.prefs.mainChat('b1')).toBe(replaced.snapshot.chatId)
    expect(warn).toHaveBeenCalledWith('[chat] conversation could not be resumed; started a new session (engine_not_found)')
    expect(await dividers()).toEqual([{ id: `session:${replaced.snapshot.chatId}`, item: { kind: 'session', text: 'New session', reason: 'not_resumed' } }])
    // Oscar starts another session before saying anything in that one: the empty one shows no divider.
    const fresh = await service.newChat('b1', () => {})
    expect(await dividers()).toEqual([{ id: `session:${fresh.snapshot.chatId}`, item: { kind: 'session', text: 'New session' } }])
  } finally {
    warn.mockRestore()
    history.close()
    f.database.close()
  }
})
