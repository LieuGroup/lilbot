import { expect, test } from 'bun:test'
import type { BotModel, ModelProvider, ReasoningEffort } from '../../shared/bot-schema'
import { modelFromKey, modelGroups, modelKey, modelLabel, modelPillView } from '../../shared/client/bots/model-choice'

const providers: ModelProvider[] = [
  { provider: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-5-5', 'claude-opus-5-5'], capabilities: [] },
  { provider: 'openrouter', name: 'OpenRouter', models: ['vendor/model::v2'], capabilities: [] }
]

test('a model survives the trip through its key, even with the separator in its name', () => {
  const model = { provider: 'openrouter', model: 'vendor/model::v2' }
  expect(modelFromKey(modelKey(model))).toEqual(model)
  expect(modelKey(null)).toBe('')
  expect(modelFromKey('')).toBeNull()
})

test('one group per provider, with "no model" on top when the form allows it', () => {
  const groups = modelGroups(providers, null, 'Same as the main bot')
  expect(groups.map(group => group.label)).toEqual([undefined, 'Anthropic', 'OpenRouter'])
  expect(groups[0].options).toEqual([{ key: '', label: 'Same as the main bot' }])
  expect(modelLabel(groups, null)).toBe('Same as the main bot')
})

test('a model the engine no longer lists is still offered, so saving does not change it', () => {
  const gone = { provider: 'old', model: 'retired-model' }
  const groups = modelGroups(providers, gone)
  expect(groups[0].options).toEqual([{ key: 'old::retired-model', label: 'retired-model' }])
  expect(modelLabel(groups, gone)).toBe('retired-model')
})

test('a listed model adds no extra group', () => {
  const groups = modelGroups(providers, { provider: 'anthropic', model: 'claude-opus-5-5' })
  expect(groups.map(group => group.label)).toEqual(['Anthropic', 'OpenRouter'])
})

const opus = { provider: 'anthropic', model: 'claude-opus-5-5' }
const sonnet = { provider: 'anthropic', model: 'claude-sonnet-5-5' }
const bot = (model: BotModel | null, reasoningEffort: ReasoningEffort | null = null, effectiveReasoningEffort?: string | null) => ({
  model,
  reasoningEffort,
  effectiveReasoningEffort
})
const plain = { effort: 'Default', differs: false, saving: false, missing: false }

test('the pill shows the saved model and effort, and the new ones with a spinner while they save', () => {
  expect(modelPillView(bot(opus, 'high'), providers, null)).toEqual({ ...plain, label: 'claude-opus-5-5', effort: 'High' })
  expect(modelPillView(bot(opus, 'high'), providers, { model: sonnet })).toEqual({ ...plain, label: 'claude-sonnet-5-5', effort: 'High', saving: true })
  expect(modelPillView(bot(opus, 'high'), providers, { reasoningEffort: null })).toEqual({ ...plain, label: 'claude-opus-5-5', saving: true })
})

test('the pill asks for a model only once the list has loaded without the saved one', () => {
  const gone = { provider: 'old', model: 'retired-model' }
  expect(modelPillView(bot(gone), null, null)).toEqual({ ...plain, label: 'retired-model' })
  expect(modelPillView(bot(gone), providers, null)).toEqual({ label: 'Choose a model', effort: null, differs: false, saving: false, missing: true })
  expect(modelPillView(bot({ provider: 'openrouter', model: 'claude-opus-5-5' }), providers, null).missing).toBe(true)
})

test('a bot without its own model shows the default, not a missing model', () => {
  expect(modelPillView(bot(null), providers, null)).toEqual({ ...plain, label: 'Default model' })
})

test('a model the engine says does not reason shows no effort and no mark', () => {
  const thinking: ModelProvider[] = [{ ...providers[0], capabilities: [{ id: 'claude-sonnet-5-5', reasoning: false, canDisableReasoning: null }] }]
  expect(modelPillView(bot(sonnet, 'max', 'high'), thinking, null)).toEqual({ ...plain, label: 'claude-sonnet-5-5', effort: null })
  expect(modelPillView(bot(opus, 'max', 'high'), thinking, null)).toEqual({ ...plain, label: 'claude-opus-5-5', effort: 'Max', differs: true })
})

test('the mark shows only once the engine has reported another level, never while a change saves', () => {
  expect(modelPillView(bot(opus, 'max'), providers, null).differs).toBe(false)
  expect(modelPillView(bot(opus, 'max', 'max'), providers, null).differs).toBe(false)
  expect(modelPillView(bot(opus, 'max', 'high'), providers, { model: sonnet }).differs).toBe(false)
})
