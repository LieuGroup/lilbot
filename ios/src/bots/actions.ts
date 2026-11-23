/** Roster and bot management actions over LilBot's existing socket protocol (1:1 with web/src/bots/bot-actions.ts). */
import type { Avatar } from '../../../shared/avatar'
import type { BotDeleteDefaults } from '../../../shared/bot-delete-schema'
import type { Bot, BotModel, BotPrefsInput } from '../../../shared/bot-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useBotMenuStore } from './menu-store'
import { useBotStore } from './store'

const reload = () => useBotStore.getState().load()

function requireSocket() {
  const socket = ensureSocket()
  if (!socket) throw new Error('Not connected to a LilBot server.')
  return socket
}

/** Runs an inline roster action and surfaces any error as a brief roster notice. */
async function attempt(action: () => Promise<unknown>) {
  useBotMenuStore.getState().setError('')
  try {
    await action()
    await reload()
  } catch (failure) {
    useBotMenuStore.getState().setError(messageOf(failure))
  }
}

export const setBotPrefs = (prefs: BotPrefsInput) => attempt(() => requireSocket().call('bots.setPrefs', prefs))
export const setBotUnread = (botId: string, unread: boolean) => attempt(() => requireSocket().call('activity.setUnread', { botId, unread }))
export const makeBotPrimary = (botId: string) => attempt(() => requireSocket().call('bots.setPrimary', { botId }))

export async function moveToNewSection(botId: string, name: string): Promise<void> {
  const socket = requireSocket()
  const section = await socket.call('sections.create', { name })
  await socket.call('bots.setPrefs', { botId, sectionId: section.id })
  await reload()
}

export async function renameSection(sectionId: string, name: string): Promise<void> {
  await requireSocket().call('sections.rename', { sectionId, name })
  await reload()
}

export async function deleteSection(sectionId: string): Promise<void> {
  await requireSocket().call('sections.delete', { sectionId })
  await reload()
}

export async function saveNameAndAvatar(botId: string, currentName: string, value: { name: string; avatar: Avatar }): Promise<void> {
  const socket = requireSocket()
  if (value.name !== currentName) await socket.call('bots.update', { botId, name: value.name })
  await socket.call('bots.setPrefs', { botId, avatar: value.avatar })
  await reload()
}

export async function createBot(input: { name: string; function: string; instructions: string; avatar: Avatar; model: BotModel | null }): Promise<Bot> {
  const socket = requireSocket()
  const bot = await socket.call('bots.create', {
    avatar: input.avatar,
    name: input.name,
    function: input.function,
    instructions: input.instructions,
    ...(input.model ? { model: input.model } : {})
  })
  useBotStore.getState().upsert(bot)
  await reload()
  return bot
}

export async function deleteBot(botId: string, choices: BotDeleteDefaults): Promise<void> {
  await requireSocket().call('bots.delete', { botId, ...choices })
  await reload()
}
