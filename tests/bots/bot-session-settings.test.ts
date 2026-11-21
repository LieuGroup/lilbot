import { expect, spyOn, test } from 'bun:test'
import type { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { SessionSettings } from '../../server/bots/bot-session-settings'
import type { BotRecord } from '../../server/bots/bot-store'
import type { BotEngine } from '../../server/engines/bot-engine'
import { LilBotError } from '../../shared/lilbot-error'

const baseBot: BotRecord = {
  id: 'b1',
  engineId: 'test',
  engineBotId: 'engine-b1',
  name: 'Bot One',
  function: '',
  instructions: '',
  model: { provider: 'p', model: 'first' },
  reasoningEffort: null,
  isDefault: false,
  permissionMode: 'full-access'
}

test('logs a fixed label with bot id and error code when the engine holds back a model switch, never engine message text', async () => {
  const engine = {
    listModels: async () => [],
    updateSession: async () => {
      throw new LilBotError('confirm_required', 'secret engine wording')
    }
  } as unknown as BotEngine
  const prefs = { mainChat: () => 'chat-1' } as unknown as BotPrefsStore
  const settings = new SessionSettings(engine, prefs, () => {})

  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const nextModel = { provider: 'p', model: 'second' }
    await expect(settings.apply({ ...baseBot, model: nextModel }, baseBot, { model: nextModel })).rejects.toMatchObject({
      code: 'confirm_required'
    })
    const logged = warn.mock.calls.map(call => call.join(' '))
    expect(logged).toEqual(['[bots] model switch held back by the engine (b1: confirm_required)'])
    expect(logged.join('\n')).not.toContain('secret engine wording')
  } finally {
    warn.mockRestore()
  }
})
