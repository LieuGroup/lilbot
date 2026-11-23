import { expect, test } from 'bun:test'
import type { ModelProvider } from '../../shared/bot-schema'
import { capabilityOf, effortLabel, effortValue, reasons, sentDiffers } from '../../shared/client/bots/reasoning-effort'

test('levels read as the menu names them; no level is the engine default; an unknown level shows as sent', () => {
  expect(['none', 'minimal', 'xhigh', 'max'].map(effortLabel)).toEqual(['Off', 'Minimal', 'Extra high', 'Max'])
  expect(effortLabel(null)).toBe('Default')
  expect(effortLabel('ultra')).toBe('ultra')
})

test('only a model the engine says does not reason hides the effort; an unlisted model or none keeps it, as the server sends it', () => {
  const providers: ModelProvider[] = [
    {
      provider: 'a',
      name: 'A',
      models: ['think', 'plain'],
      capabilities: [
        { id: 'think', reasoning: true, canDisableReasoning: false },
        { id: 'plain', reasoning: false, canDisableReasoning: null }
      ]
    }
  ]
  expect(capabilityOf(providers, { provider: 'a', model: 'think' })?.canDisableReasoning).toBe(false)
  expect(reasons(capabilityOf(providers, { provider: 'a', model: 'plain' }))).toBe(false)
  expect(reasons(capabilityOf(providers, { provider: 'b', model: 'plain' }))).toBe(true)
  expect(reasons(capabilityOf(providers, null))).toBe(true)
  expect(reasons(capabilityOf(null, { provider: 'a', model: 'plain' }))).toBe(true)
})

test('chosen and sent differ only when the engine reported another level; Off and Default both report none', () => {
  expect(sentDiffers('max', 'high')).toBe(true)
  expect(sentDiffers('high', null)).toBe(true)
  expect(sentDiffers('max', undefined)).toBe(false)
  expect(sentDiffers('none', null)).toBe(false)
  expect(sentDiffers(null, null)).toBe(false)
  expect(sentDiffers(null, 'medium')).toBe(false)
  expect(effortValue('max', 'high')).toBe('Max, sent as High')
  expect(effortValue('high', null)).toBe('High, sent as Off')
  expect(effortValue('none', null)).toBe('Off')
})
