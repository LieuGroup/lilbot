import { expect, test } from 'bun:test'
import type { BotModel, ModelProvider } from '../../shared/bot-schema'
import { fakeService } from '../helpers/fake-engine'

const THINKS: BotModel = { provider: 'p', model: 'thinks' }
const OTHER_THINKS: BotModel = { provider: 'p', model: 'other' }
const PLAIN: BotModel = { provider: 'p', model: 'plain' }

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

async function setup(model: BotModel = THINKS, reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | null = 'xhigh') {
  const f = fakeService()
  f.models.value = providers
  await f.service.prepareRuntimes()
  await f.service.updateBot({ botId: 'b1', model, reasoningEffort })
  const calls: { model?: BotModel; reasoningEffort?: string }[] = []
  const original = f.engine.runRoutine
  f.engine.runRoutine = (botId, prompt, options) => {
    calls.push({ model: options.model, reasoningEffort: options.reasoningEffort })
    return original(botId, prompt, options)
  }
  return { ...f, calls }
}

test('explicit model and reasoning effort are forwarded when the target model thinks', async () => {
  const f = await setup(THINKS, 'low')
  await f.service.runRoutine('b1', 'task', { runId: 'r1', model: OTHER_THINKS, reasoningEffort: 'high', onChat: () => {} })
  expect(f.calls).toEqual([{ model: OTHER_THINKS, reasoningEffort: 'high' }])
})

test('explicit reasoning effort on the bot’s own model overrides the bot’s saved effort when it thinks', async () => {
  const f = await setup(THINKS, 'low')
  await f.service.runRoutine('b1', 'task', { runId: 'r1', reasoningEffort: 'high', onChat: () => {} })
  await f.service.updateBot({ botId: 'b1', reasoningEffort: null })
  await f.service.runRoutine('b1', 'task', { runId: 'r2', reasoningEffort: 'medium', onChat: () => {} })
  expect(f.calls).toEqual([
    { model: undefined, reasoningEffort: 'high' },
    { model: undefined, reasoningEffort: 'medium' }
  ])
})

test('explicit model without reasoning effort omits effort rather than inheriting the bot’s effort', async () => {
  const f = await setup(THINKS, 'xhigh')
  await f.service.runRoutine('b1', 'task', { runId: 'r1', model: OTHER_THINKS, onChat: () => {} })
  expect(f.calls).toEqual([{ model: OTHER_THINKS, reasoningEffort: undefined }])
})

test('explicit reasoning effort is omitted when the effective model does not think', async () => {
  const f = await setup(PLAIN, 'high')
  await f.service.runRoutine('b1', 'task', { runId: 'r1', reasoningEffort: 'high', onChat: () => {} })
  await f.service.runRoutine('b1', 'task', { runId: 'r2', model: PLAIN, reasoningEffort: 'high', onChat: () => {} })
  await f.service.runRoutine('b1', 'task', { runId: 'r3', model: THINKS, reasoningEffort: 'medium', onChat: () => {} })
  expect(f.calls).toEqual([
    { model: undefined, reasoningEffort: undefined },
    { model: PLAIN, reasoningEffort: undefined },
    { model: THINKS, reasoningEffort: 'medium' }
  ])
})
