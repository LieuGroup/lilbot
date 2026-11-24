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

test('queued sends pair FIFO across three turns, drop rejected sends, and recover mid-turn after restart without re-queueing replays', async () => {
  const f = fakeService()
  const history = new HistoryService(
    new HistoryStore(f.database),
    f.engine,
    async () => [],
    () => true
  )
  const completed: { user: string; assistant: string }[] = []
  let rejectNextSend = false
  let observe: ((botId: string, chatId: string, event: ChatEvent, key: string) => void) | undefined
  f.engine.watchActivity = (_bots, _emit, _cursor, _avail, onConversation) => {
    observe = onConversation
    return () => {}
  }
  const origOpen = f.engine.openChat
  f.engine.openChat = async (botId, chatId, options, onEvent) => {
    const chat = await origOpen(botId, chatId, options, onEvent)
    const origSend = chat.send
    chat.send = async (text, sendOpts) => {
      if (rejectNextSend) {
        rejectNextSend = false
        throw new Error('send rejected')
      }
      await origSend(text, sendOpts)
    }
    return chat
  }
  const makeService = () => {
    const service = new BotService(f.engine, f.store, f.prefs, new Workspaces(f.root), f.memory, {
      history,
      conversationHooks: { onTurnCompleted: (_b, _c, user, assistant) => completed.push({ user, assistant }) }
    })
    service.watchActivity(
      () => {},
      () => undefined
    )
    return service
  }
  try {
    const first = makeService()
    const chat = await first.openChat('b1', undefined, () => {})
    const chatId = chat.snapshot.chatId

    // Three queued sends in a row + a rejected send in the middle.
    await chat.send('User-1')
    rejectNextSend = true
    await expect(chat.send('Rejected-Send')).rejects.toThrow('send rejected')
    await chat.send('User-2')
    await chat.send('User-3')

    f.emit(chatId, { type: 'turn.finished', status: 'completed', text: 'Reply-1', rowId: 'r1' })
    f.emit(chatId, { type: 'turn.finished', status: 'completed', text: 'Reply-2', rowId: 'r2' })
    f.emit(chatId, { type: 'turn.finished', status: 'completed', text: 'Reply-3', rowId: 'r3' })
    // Duplicate observe of r3 must not re-fire.
    observe!('b1', chatId, { type: 'turn.finished', status: 'completed', text: 'Reply-3', rowId: 'r3' }, 'e1:3')
    expect(completed).toEqual([
      { user: 'User-1', assistant: 'Reply-1' },
      { user: 'User-2', assistant: 'Reply-2' },
      { user: 'User-3', assistant: 'Reply-3' }
    ])

    // Failed earlier turn shifts its queued user so the following queued turn stays aligned.
    completed.length = 0
    await chat.send('Failed-User')
    await chat.send('After-Failure')
    f.emit(chatId, { type: 'turn.finished', status: 'failed', text: '', rowId: 'r-fail' })
    f.emit(chatId, { type: 'turn.finished', status: 'completed', text: 'Reply-After', rowId: 'r-after' })
    expect(completed).toEqual([{ user: 'After-Failure', assistant: 'Reply-After' }])

    // Mid-turn restart: User-4 is sent before restart, then a brand-new BotService starts on the same SQLite DB.
    completed.length = 0
    await chat.send('User-4-Before-Restart')
    chat.close()

    makeService()
    // Replaying pre-restart r-after must NOT re-queue; new r4 MUST recover User-4 from stored history.
    observe!('b1', chatId, { type: 'turn.finished', status: 'completed', text: 'Reply-After', rowId: 'r-after' }, 'e1:5')
    observe!('b1', chatId, { type: 'turn.finished', status: 'completed', text: 'Reply-4-After-Restart', rowId: 'r4' }, 'e1:6')
    // A subsequent hidden turn finishing with no unanswered user message must NOT re-pair User-4.
    observe!('b1', chatId, { type: 'turn.finished', status: 'completed', text: 'Hidden-Followup', rowId: 'r5' }, 'e1:7')
    expect(completed).toEqual([{ user: 'User-4-Before-Restart', assistant: 'Reply-4-After-Restart' }])
  } finally {
    f.database.close()
  }
})
