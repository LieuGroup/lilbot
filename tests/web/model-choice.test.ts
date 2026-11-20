import { expect, test } from 'bun:test'
import type { ModelProvider } from '../../shared/bot-schema'
import { modelFromKey, modelGroups, modelKey, modelLabel, modelPillView } from '../../web/src/bots/model-choice'

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

test('the pill shows the saved model, and the new one with a spinner while it saves', () => {
  expect(modelPillView(opus, providers, null)).toEqual({ label: 'claude-opus-5-5', saving: false, missing: false })
  const sonnet = { provider: 'anthropic', model: 'claude-sonnet-5-5' }
  expect(modelPillView(opus, providers, sonnet)).toEqual({ label: 'claude-sonnet-5-5', saving: true, missing: false })
})

test('the pill asks for a model only once the list has loaded without the saved one', () => {
  const gone = { provider: 'old', model: 'retired-model' }
  expect(modelPillView(gone, null, null)).toEqual({ label: 'retired-model', saving: false, missing: false })
  expect(modelPillView(gone, providers, null)).toEqual({ label: 'Choose a model', saving: false, missing: true })
  expect(modelPillView({ provider: 'openrouter', model: 'claude-opus-5-5' }, providers, null).missing).toBe(true)
})

test('a bot without its own model shows the default, not a missing model', () => {
  expect(modelPillView(null, providers, null)).toEqual({ label: 'Default model', saving: false, missing: false })
})
