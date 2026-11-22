import { expect, spyOn, test } from 'bun:test'
import { ActivityService } from '../../server/activity/activity-service'
import { ActivityStore } from '../../server/activity/activity-store'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import { HermesEngine } from '../../server/engines/hermes/hermes-engine'
import { HermesSocket } from '../../server/engines/hermes/hermes-socket'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { detail } from '../helpers/fake-engine'

test('bound activity uses native sockets and LilBot ids for unread and durable cursors; missing runtimes are skipped', async () => {
  const db = openDatabase(':memory:')
  const store = new BotStore(db)
  store.import('hermes', [
    { ...detail, id: 'lilbot', engineId: 'hermes', engineBotId: 'native' },
    { ...detail, id: 'missing', engineId: 'hermes', engineBotId: 'deleted' },
    { ...detail, id: 'other', engineId: 'other-engine', engineBotId: 'native-other' }
  ])
  const engine = new HermesEngine()
  const prepare = spyOn(engine, 'prepareRuntime').mockResolvedValue(undefined)
  const apply = spyOn(engine, 'applyIdentity').mockResolvedValue({ abilities: [], memoryConnected: false })
  const service = new BotService(engine, store, new BotPrefsStore(db), new Workspaces('/unused'), new MemoryService(new MemoryStore(db)))
  const activityStore = new ActivityStore(db)
  activityStore.accept('lilbot', 'chat', 'epoch:1')
  const activity = new ActivityService(activityStore, () => {})
  let present = true
  const closed: string[] = []
  const connect = spyOn(HermesSocket, 'connect').mockImplementation(
    async profile =>
      ({
        isOpen: true,
        close: () => closed.push(profile),
        request: async (method: string) => {
          if (method === 'profiles.list') return { profiles: present ? [{ name: 'native' }, { name: 'unbound' }] : [] }
          if (method === 'session.list') return { sessions: [{ session_id: 'chat', running: true, started_at: Date.now() / 1000 }] }
          return { replay_epoch: 'epoch', last_sequence: 2, truncated: false, events: [{ seq: 2, type: 'message.delta', payload: { text: 'Hello' } }] }
        }
      }) as unknown as HermesSocket
  )
  const cursorCalls: string[] = []
  const stop = service.watchActivity(
    event => activity.observe(event),
    (botId, chatId) => {
      cursorCalls.push(botId)
      return activity.cursor(botId, chatId)
    }
  )
  try {
    await Bun.sleep(100)
    expect(connect.mock.calls.map(call => call[0])).toEqual(['', 'native'])
    expect(cursorCalls).toEqual(['lilbot'])
    expect(activity.state('lilbot')).toMatchObject({ status: 'working', unread: true })
    expect(activity.state('native')).toMatchObject({ status: 'idle', unread: false })
    expect(activityStore.cursor('lilbot', 'chat')).toBe('epoch:2')
    expect(activityStore.cursor('native', 'chat')).toBeUndefined()
    present = false
    await Bun.sleep(1100)
    expect(closed).toEqual(['native'])
    expect((await service.listBots()).find(bot => bot.id === 'lilbot')?.runnable).toBe(false)
    expect(connect.mock.calls.map(call => call[0])).toEqual(['', 'native'])
  } finally {
    stop()
    activity.close()
    connect.mockRestore()
    prepare.mockRestore()
    apply.mockRestore()
    db.close()
  }
})
