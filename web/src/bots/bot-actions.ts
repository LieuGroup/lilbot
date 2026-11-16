/** What the bot menu does, through the protocol. The server pushes `bots.changed` after each
 *  change; reloading here as well makes the roster move without waiting for the push. */
import type { Avatar } from '../../../shared/avatar'
import type { BotDeleteDefaults } from '../../../shared/bot-delete-schema'
import type { BotPrefsInput } from '../../../shared/bot-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useBotMenu } from './bot-menu-target'
import { useBotStore } from './bot-store'

const reload = () => useBotStore.getState().load()

/** Run a menu action; a failure is shown in the roster until the next action. */
export async function attempt(action: () => Promise<unknown>) {
  useBotMenu.setState({ error: '' })
  try {
    await action()
    await reload()
  } catch (failure) {
    useBotMenu.setState({ error: messageOf(failure) })
  }
}

export const setPrefs = (prefs: BotPrefsInput) => attempt(() => lilbot.call('bots.setPrefs', prefs))
export const setUnread = (botId: string, unread: boolean) => attempt(() => lilbot.call('activity.setUnread', { botId, unread }))
export const makePrimary = (botId: string) => attempt(() => lilbot.call('bots.setPrimary', { botId }))

/** Create a section and move the bot into it. Errors go to the dialog that asked. */
export async function moveToNewSection(botId: string, name: string) {
  const section = await lilbot.call('sections.create', { name })
  await lilbot.call('bots.setPrefs', { botId, sectionId: section.id })
  await reload()
}

/** Save the name (when it changed) and the avatar. Errors go to the dialog that asked. */
export async function saveNameAndAvatar(botId: string, current: string, value: { name: string; avatar: Avatar }) {
  if (value.name !== current) await lilbot.call('bots.update', { botId, name: value.name })
  await lilbot.call('bots.setPrefs', { botId, avatar: value.avatar })
  await reload()
}

export async function deleteBot(botId: string, choices: BotDeleteDefaults) {
  await lilbot.call('bots.delete', { botId, ...choices })
  await reload()
}
