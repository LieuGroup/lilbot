import { expect, test } from 'bun:test'
import { instructionsNote } from '../../web/src/bots/instructions-note'

test('the Setup tab shows why LilBot’s own prompt is not in use, and nothing once it is', () => {
  expect(instructionsNote({ promptFallback: 'prompt file missing' })).toBe(
    'LilBot’s own system prompt is not in use for this bot, so the engine’s own prompt answers (prompt file missing).'
  )
  expect(instructionsNote({})).toBeUndefined()
})

test('the identity note names no engine and joins the fallback line', () => {
  const identity = instructionsNote({ engineIdentityInInstructions: true })!
  expect(identity).toBe('These instructions mention the engine’s default identity, which some models reject. Edit and save to remove it.')
  expect(identity).not.toMatch(/hermes|nous/i)
  expect(instructionsNote({ promptFallback: 'prompt plug-in not enabled', engineIdentityInInstructions: true })).toBe(
    `LilBot’s own system prompt is not in use for this bot, so the engine’s own prompt answers (prompt plug-in not enabled). ${identity}`
  )
})
