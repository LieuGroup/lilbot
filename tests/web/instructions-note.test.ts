import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BotDetail } from '../../shared/bot-schema'
import { SetupForm } from '../../web/src/bots/bot-setup-panel'
import { instructionsNote } from '../../web/src/bots/instructions-note'
import { testBot } from './test-bot'

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

test('the Setup tab puts the line under Instructions', () => {
  const bot = { ...testBot('b'), instructions: 'I am the default engine.', abilities: [], memoryConnected: true }
  const render = (extra: Partial<BotDetail>) => renderToStaticMarkup(createElement(SetupForm, { bot: { ...bot, ...extra }, onKept: () => {}, onSaved: () => {} }))
  expect(render({ promptFallback: 'prompt file missing', engineIdentityInInstructions: true })).toContain(
    `${instructionsNote({ promptFallback: 'prompt file missing', engineIdentityInInstructions: true })}</p>`
  )
  expect(render({})).not.toContain('engine’s')
})
