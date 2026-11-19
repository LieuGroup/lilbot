import { expect, test } from 'bun:test'
import { botCapability } from '../../server/bots/bot-capability'
import type { BotService } from '../../server/bots/bot-service'
import { openDatabase } from '../../server/database/database'
import type { BotEngine } from '../../server/engines/bot-engine'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { createEngineApi } from '../../server/http/engine-api'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'

test('history search derives its caller from the capability and never trusts body botId', async () => {
  const db = openDatabase(':memory:')
  try {
    const store = new HistoryStore(db)
    for (const bot of ['a', 'b']) {
      store.session(bot, 's', 1)
      store.write(bot, 's', [{ id: bot, at: 1, order: 1, item: { kind: 'user', text: `orchid ${bot}` } }])
    }
    const history = new HistoryService(
      store,
      {} as BotEngine,
      async () => [],
      () => true
    )
    const api = createEngineApi(new MemoryService(new MemoryStore(db)), 'test-token', 4321, {
      history,
      bots: { listBots: async () => [{ id: 'a' }, { id: 'b' }] } as unknown as BotService,
      botExists: id => id === 'a' || id === 'b'
    })
    const request = (capability: string) =>
      new Request('http://127.0.0.1:4321/engine/history/search', {
        method: 'POST',
        headers: { host: '127.0.0.1:4321', authorization: 'Bearer test-token', 'x-lilbot-bot-capability': capability },
        body: JSON.stringify({ botId: 'b', query: 'orchid' })
      })
    const reply = await api(request(botCapability('test-token', 'a')), '/engine/history/search')
    expect(reply.status).toBe(200)
    expect((await reply.json()).matches.map((m: any) => m.id)).toEqual(['a'])
    expect((await api(request('forged'), '/engine/history/search')).status).toBe(403)
  } finally {
    db.close()
  }
})
