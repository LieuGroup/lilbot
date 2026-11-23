import { expect, test } from 'bun:test'
import { BotService } from '../../server/bots/bot-service'
import { Workspaces } from '../../server/bots/workspaces'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import type { ChatEvent } from '../../shared/chat-schema'
import { fakeService } from '../helpers/fake-engine'

for (const fresh of [false, true]) {
  test(`${fresh ? 'new' : 'opened'} main chat journals early events and visible sends, and closes on a history failure`, async () => {
    const early: ChatEvent = { type: 'text.delta', text: 'Early reply' }
    const f = fakeService({ earlyEvents: [early] })
    const history = new HistoryService(
      new HistoryStore(f.database),
      f.engine,
      async () => [],
      () => true
    )
    const recorded: ChatEvent[] = []
    history.record = (_bot, _session, event) => {
      recorded.push(event)
    }
    const service = new BotService(f.engine, f.store, f.prefs, new Workspaces(f.root), f.memory, { history })
    const open = () => (fresh ? service.newChat('b1', () => {}) : service.openChat('b1', undefined, () => {}))
    try {
      const chat = await open()
      expect(recorded).toEqual([early])
      await chat.send('Visible', { inputId: 'visible' })
      await chat.send('Hidden', { hidden: true, inputId: 'hidden' })
      expect(recorded).toHaveLength(2)
      expect(recorded[1]).toMatchObject({ type: 'user.message', messageId: 'visible', text: 'Visible' })
      chat.close()
      history.latest = async () => {
        throw new Error('history failed')
      }
      await expect(open()).rejects.toThrow('history failed')
      expect(f.log.at(-1)).toStartWith('close:')
    } finally {
      f.database.close()
    }
  })
}

test('openedAsMain short-circuits readOnlyChat even after another client moves the main pointer', async () => {
  const f = fakeService()
  let readOnlyChecks = 0
  const service = new BotService(f.engine, f.store, f.prefs, new Workspaces(f.root), f.memory, {
    readOnlyChat: () => {
      readOnlyChecks++
      return true
    }
  })
  try {
    // Open main implicitly (undefined) and explicitly (chatId === main), then advance main via newChat.
    const implicitMain = await service.openChat('b1', undefined, () => {})
    const firstId = implicitMain.snapshot.chatId
    const explicitMain = await service.openChat('b1', firstId, () => {})
    const moved = await service.newChat('b1', () => {})
    expect(moved.snapshot.chatId).not.toBe(firstId)

    // Both handles opened as main bypass readOnlyChat completely and send cleanly.
    await implicitMain.send('from implicit main')
    await explicitMain.send('from explicit main')
    await moved.send('from moved main')
    expect(readOnlyChecks).toBe(0)
    expect(f.log).toContain(`send:${firstId}:from implicit main`)
    expect(f.log).toContain(`send:${firstId}:from explicit main`)
    expect(f.log).toContain(`send:${moved.snapshot.chatId}:from moved main`)

    // A non-main chat handle still consults readOnlyChat and is refused when it returns true.
    f.stored.add('other-run')
    const other = await service.openChat('b1', 'other-run', () => {}, true)
    await expect(other.send('blocked')).rejects.toMatchObject({ code: 'chat_read_only' })
    expect(readOnlyChecks).toBe(1)

    implicitMain.close()
    explicitMain.close()
    moved.close()
    other.close()
  } finally {
    f.database.close()
  }
})
