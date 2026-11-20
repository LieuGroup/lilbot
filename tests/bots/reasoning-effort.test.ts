import { expect, test } from 'bun:test'
import { BotUpdateInput, type ModelProvider, ReasoningEffort } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/protocol'
import { fakeService } from '../helpers/fake-engine'

const THINKS = { provider: 'p', model: 'thinks' }
const PLAIN = { provider: 'p', model: 'plain' }
const providers: ModelProvider[] = [
  {
    provider: 'p',
    name: 'P',
    models: ['thinks', 'other', 'plain'],
    capabilities: [
      { id: 'thinks', reasoning: true, canDisableReasoning: null },
      { id: 'other', reasoning: true, canDisableReasoning: null },
      { id: 'plain', reasoning: false, canDisableReasoning: null }
    ]
  }
]

/** A service whose bot has a main conversation, as a bot Oscar has chatted with does. */
async function withMainChat(model = THINKS) {
  const f = fakeService()
  f.models.value = providers
  await f.service.prepareRuntimes()
  await f.service.updateBot({ botId: 'b1', model })
  f.sessionChanges.length = 0
  const chat = await f.service.openChat('b1', undefined, () => {})
  return { ...f, chat }
}

test('an unknown effort is refused before anything is saved, and null clears it', () => {
  expect(BotUpdateInput.safeParse({ botId: 'b1', reasoningEffort: 'ultra' }).success).toBe(false)
  for (const level of [...ReasoningEffort.options, null]) expect(BotUpdateInput.parse({ botId: 'b1', reasoningEffort: level }).reasoningEffort).toBe(level)
})

test('the effort is saved with the bot, and a model change never rewrites it', async () => {
  const f = await withMainChat()
  await f.service.updateBot({ botId: 'b1', reasoningEffort: 'high' })
  expect(f.store.get('b1').reasoningEffort).toBe('high')
  await f.service.updateBot({ botId: 'b1', model: PLAIN })
  await f.service.updateBot({ botId: 'b1', model: { provider: 'p', model: 'other' } })
  expect((await f.service.getBot('b1')).reasoningEffort).toBe('high')
  await f.service.updateBot({ botId: 'b1', reasoningEffort: null })
  expect(f.store.get('b1').reasoningEffort).toBeNull()
})

test('an edit is saved first and then reaches the open main conversation, effort alone or model with effort', async () => {
  const f = await withMainChat()
  await f.service.updateBot({ botId: 'b1', reasoningEffort: 'high' })
  expect(f.sessionChanges).toEqual([{ botId: 'b1', chatId: f.chat.snapshot.chatId, change: { reasoningEffort: 'high' } }])
  f.sessionChanges.length = 0
  await f.service.updateBot({ botId: 'b1', model: { provider: 'p', model: 'other' } })
  expect(f.sessionChanges.map(entry => entry.change)).toEqual([{ model: { provider: 'p', model: 'other' }, reasoningEffort: 'high' }])
})

test('an effort for a model without reasoning is stored but not sent; it is sent again once the model thinks', async () => {
  const f = await withMainChat(PLAIN)
  await f.service.updateBot({ botId: 'b1', reasoningEffort: 'low' })
  expect(f.store.get('b1').reasoningEffort).toBe('low')
  expect(f.sessionChanges).toEqual([])
  await f.service.updateBot({ botId: 'b1', model: THINKS })
  expect(f.sessionChanges.map(entry => entry.change)).toEqual([{ model: THINKS, reasoningEffort: 'low' }])
})

test('going back to the default level is sent when the model thinks, so a level chosen earlier does not linger', async () => {
  const f = await withMainChat()
  await f.service.updateBot({ botId: 'b1', reasoningEffort: 'high' })
  f.sessionChanges.length = 0
  await f.service.updateBot({ botId: 'b1', reasoningEffort: null })
  expect(f.sessionChanges.map(entry => entry.change)).toEqual([{ reasoningEffort: null }])
})

test('edits that change neither model nor effort, and bots with no main conversation yet, touch no session', async () => {
  const f = await withMainChat()
  await f.service.updateBot({ botId: 'b1', name: 'Renamed', model: THINKS })
  expect(f.sessionChanges).toEqual([])
  const fresh = fakeService()
  await fresh.service.prepareRuntimes()
  await fresh.service.updateBot({ botId: 'b1', reasoningEffort: 'high' })
  expect(fresh.sessionChanges).toEqual([])
  expect(fresh.store.get('b1').reasoningEffort).toBe('high')
})

test('when the engine cannot apply the edit it is still saved, the error is reported, and the next edit tries again', async () => {
  const f = await withMainChat()
  f.failUpdates.value = true
  await expect(f.service.updateBot({ botId: 'b1', model: { provider: 'p', model: 'other' }, reasoningEffort: 'high' })).rejects.toBeInstanceOf(LilBotError)
  expect(f.store.get('b1')).toMatchObject({ model: { provider: 'p', model: 'other' }, reasoningEffort: 'high' })
  f.failUpdates.value = false
  f.sessionChanges.length = 0
  await f.service.updateBot({ botId: 'b1', name: 'Renamed' })
  expect(f.sessionChanges).toEqual([])
  await f.service.updateBot({ botId: 'b1', reasoningEffort: 'high' })
  expect(f.sessionChanges.map(entry => entry.change)).toEqual([{ model: { provider: 'p', model: 'other' }, reasoningEffort: 'high' }])
})

test('a switch the engine holds back is reported, the choice stays saved, the level still applies, and later effort edits do not repeat the switch', async () => {
  const f = await withMainChat()
  f.holdModelSwitch.value = true
  await expect(f.service.updateBot({ botId: 'b1', model: { provider: 'p', model: 'other' }, reasoningEffort: 'high' })).rejects.toMatchObject({ code: 'confirm_required' })
  expect(f.store.get('b1')).toMatchObject({ model: { provider: 'p', model: 'other' }, reasoningEffort: 'high' })
  expect(f.sessionChanges.map(entry => entry.change)).toEqual([{ model: { provider: 'p', model: 'other' }, reasoningEffort: 'high' }, { reasoningEffort: 'high' }])
  expect((await f.service.getBot('b1')).effectiveReasoningEffort).toBe('high')
  f.sessionChanges.length = 0
  await f.service.updateBot({ botId: 'b1', reasoningEffort: 'low' })
  expect(f.sessionChanges.map(entry => entry.change)).toEqual([{ reasoningEffort: 'low' }])
})

test('two quick edits to one bot reach the engine one after the other, never overlapping', async () => {
  const f = await withMainChat()
  const order: string[] = []
  const update = f.engine.updateSession
  f.engine.updateSession = async (botId, chatId, change) => {
    order.push('start')
    await Bun.sleep(20)
    const result = await update(botId, chatId, change)
    order.push('end')
    return result
  }
  await Promise.all([f.service.updateBot({ botId: 'b1', reasoningEffort: 'low' }), f.service.updateBot({ botId: 'b1', reasoningEffort: 'high' })])
  expect(order).toEqual(['start', 'end', 'start', 'end'])
  expect(f.store.get('b1').reasoningEffort).toBe('high')
})

test('every new session gets the effort: chats, routine runs and bot threads; a model that does not think gets none', async () => {
  const f = await withMainChat()
  await f.service.updateBot({ botId: 'b1', reasoningEffort: 'xhigh' })
  await f.service.newChat('b1', () => {})
  await f.service.runRoutine('b1', 'task', { runId: 'r1', onChat: () => {} })
  expect(f.created.map(session => session.reasoningEffort)).toEqual([undefined, 'xhigh', 'xhigh'])
  await f.service.updateBot({ botId: 'b1', model: PLAIN })
  await f.service.newChat('b1', () => {})
  await f.service.runRoutine('b1', 'task', { runId: 'r2', onChat: () => {} })
  expect(f.created.slice(3).map(session => session.reasoningEffort)).toEqual([undefined, undefined])
})

test('what the engine says it sends is exposed for the main conversation only, and a change is pushed once', async () => {
  const f = fakeService({})
  f.models.value = providers
  await f.service.prepareRuntimes()
  const before = f.changes()
  const original = f.engine.openChat
  let report: ((effort: string | null) => void) | undefined
  f.engine.openChat = async (botId, chatId, options, onEvent) => {
    report = options.onEffort
    options.onEffort?.('medium')
    return original(botId, chatId, options, onEvent)
  }
  const main = await f.service.openChat('b1', undefined, () => {})
  expect((await f.service.getBot('b1')).effectiveReasoningEffort).toBe('medium')
  expect((await f.service.listBots())[0].effectiveReasoningEffort).toBe('medium')
  const afterOpen = f.changes()
  expect(afterOpen).toBeGreaterThan(before)
  report?.('medium')
  expect(f.changes()).toBe(afterOpen)
  report?.('low')
  expect(f.changes()).toBe(afterOpen + 1)
  expect((await f.service.getBot('b1')).effectiveReasoningEffort).toBe('low')
  // Another chat of the bot (a new session is the new main one; a stored routine chat is not).
  await f.service.openChat('b1', 'routine-chat', () => {}, true)
  expect((await f.service.getBot('b1')).effectiveReasoningEffort).toBe('low')
  expect(main.snapshot.chatId).toBeTruthy()
})
