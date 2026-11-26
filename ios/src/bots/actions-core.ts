/** Pure roster action factory over LilBot's existing socket protocol (1:1 with web/src/bots/bot-actions.ts).
 *  Zero React Native/Expo imports so unit tests verify disconnect and error paths on Linux. */
import type { Avatar } from '../../../shared/avatar'
import type { BotDeleteDefaults } from '../../../shared/bot-delete-schema'
import type { Bot, BotModel, BotPrefsInput, Section } from '../../../shared/bot-schema'
import { messageOf } from '../../../shared/client/socket'

export interface BotActionsSocket {
  call(method: 'bots.setPrefs', params: BotPrefsInput): Promise<unknown>
  call(method: 'activity.setUnread', params: { botId: string; unread: boolean }): Promise<unknown>
  call(method: 'bots.setPrimary', params: { botId: string }): Promise<unknown>
  call(method: 'sections.create', params: { name: string }): Promise<Section>
  call(method: 'bots.update', params: { botId: string; name: string }): Promise<unknown>
  call(method: 'bots.create', params: { avatar: Avatar; name: string; function: string; instructions: string; model?: BotModel }): Promise<Bot>
  call(method: 'bots.delete', params: { botId: string } & BotDeleteDefaults): Promise<unknown>
}

export interface BotActionDeps {
  getSocket: () => BotActionsSocket | null
  reload: () => Promise<void>
  upsert: (bot: Bot) => void
  setError: (message: string) => void
}

export function createBotActions(deps: BotActionDeps) {
  const requireSocket = () => {
    const socket = deps.getSocket()
    if (!socket) throw new Error('Not connected to a LilBot server.')
    return socket
  }

  const attempt = async (action: () => Promise<unknown>) => {
    deps.setError('')
    try {
      await action()
      await deps.reload()
    } catch (failure) {
      deps.setError(messageOf(failure))
    }
  }

  let primaryInFlight: Promise<void> | null = null

  return {
    setBotPrefs: (prefs: BotPrefsInput) => attempt(() => requireSocket().call('bots.setPrefs', prefs)),
    setBotUnread: (botId: string, unread: boolean) => attempt(() => requireSocket().call('activity.setUnread', { botId, unread })),
    /** One primary change at a time: a second tap while one is in flight joins it instead of sending again. */
    makeBotPrimary: (botId: string) => {
      primaryInFlight ??= attempt(() => requireSocket().call('bots.setPrimary', { botId })).finally(() => {
        primaryInFlight = null
      })
      return primaryInFlight
    },
    moveToNewSection: async (botId: string, name: string): Promise<void> => {
      const socket = requireSocket()
      const section = await socket.call('sections.create', { name })
      await socket.call('bots.setPrefs', { botId, sectionId: section.id })
      await deps.reload()
    },
    saveNameAndAvatar: async (botId: string, currentName: string, value: { name: string; avatar: Avatar }): Promise<void> => {
      const socket = requireSocket()
      if (value.name !== currentName) await socket.call('bots.update', { botId, name: value.name })
      await socket.call('bots.setPrefs', { botId, avatar: value.avatar })
      await deps.reload()
    },
    createBot: async (input: { name: string; function: string; instructions: string; avatar: Avatar; model: BotModel | null }): Promise<Bot> => {
      const socket = requireSocket()
      const bot = await socket.call('bots.create', {
        avatar: input.avatar,
        name: input.name,
        function: input.function,
        instructions: input.instructions,
        ...(input.model ? { model: input.model } : {})
      })
      deps.upsert(bot)
      await deps.reload()
      return bot
    },
    deleteBot: async (botId: string, choices: BotDeleteDefaults): Promise<void> => {
      await requireSocket().call('bots.delete', { botId, ...choices })
      await deps.reload()
    }
  }
}
