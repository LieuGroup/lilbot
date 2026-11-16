import { expect, test } from 'bun:test'
import type { ModelProvider } from '../../shared/bot-schema'
import { modelFromKey, modelGroups, modelKey, modelLabel } from '../../web/src/bots/model-choice'

const providers: ModelProvider[] = [
  { provider: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-5-5', 'claude-opus-5-5'] },
  { provider: 'openrouter', name: 'OpenRouter', models: ['vendor/model::v2'] }
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
