/** The browser <-> LilBot server protocol: JSON frames over one WebSocket. */

import { z } from 'zod'
import { AttachmentFile } from './attachment-schema'
import { BotDeleteDefaults, BotDeleteInput } from './bot-delete-schema'
import { type Bot, BotCreateInput, type BotDetail, BotPrefsInput, BotUpdateInput, type ModelProvider, type Section, sectionName } from './bot-schema'
import type { ChatEvent, ChatSnapshot } from './chat-schema'
import { AddThisSystem } from './computer-add-schema'
import { DeviceId, DeviceName } from './device-schema'
import { LibraryListInput, type LibraryPage, type WorkspaceEntry } from './library-schema'
import { type MemoryFact, MemoryWriteInput } from './memory-schema'
import type { Routine } from './routine-schema'

const botId = z.string().min(1)
const chatId = z.string().min(1)

/** Each method's params schema (checked on the server) and result type (trusted by the browser). */
export const methods = {
  'attachments.limits': z.object({}),
  'attachments.prepare': z.object({ botId, files: z.array(AttachmentFile).max(100) }),
  'attachments.status': z.object({ botId, ids: z.array(z.string().uuid()).max(100) }),
  'deploy.status': z.object({}),
  'threads.list': z.object({ botId }),
  'threads.open': z.object({ botId, threadId: z.string().min(1) }),
  'threads.cancel': z.object({ botId, threadId: z.string().min(1) }),
  'computers.list': z.object({}),
  'computers.installCode': z.object({ name: z.string().trim().min(1).max(100) }),
  'computers.remove': z.object({ computer: z.string().min(1) }),
  /** Marks the computer bots use when a message comes from a device that is not a computer; null clears it. */
  'computers.setMain': z.object({ computer: z.string().min(1).nullable() }),
  /** This device's record; the first call makes it, named by `name` (the client's own guess). Later calls ignore `name`. */
  'devices.current': z.object({ deviceId: DeviceId, name: DeviceName }),
  'devices.rename': z.object({ deviceId: DeviceId, name: DeviceName }),
  /** Says which connected computer this device runs on; null clears it. */
  'devices.linkComputer': z.object({ deviceId: DeviceId, computer: z.string().min(1).nullable() }),
  /** Starts "Add this computer" on this device: a fresh code, the hand-over address and the matching download. */
  'computers.addThis.start': z.object({ name: z.string().trim().min(1).max(100), system: AddThisSystem, deviceId: DeviceId.optional() }),
  'computers.addThis.status': z.object({ attemptId: z.string().uuid() }),
  'skills.list': z.object({ botId }),
  'skills.read': z.object({ botId, name: z.string() }),
  'skills.setEnabled': z.object({ botId, name: z.string(), enabled: z.boolean() }),
  'skills.engines': z.object({}),
  'skills.setEngine': z.object({ engineId: z.string(), included: z.boolean() }),
  'routines.list': z.object({ botId }),
  'routines.pause': z.object({ botId, id: z.string().min(1) }),
  'routines.resume': z.object({ botId, id: z.string().min(1) }),
  'routines.delete': z.object({ botId, id: z.string().min(1) }),
  'routines.openRun': z.object({ botId, runId: z.string().min(1) }),
  'library.list': LibraryListInput,
  'library.content': z.object({ botId, itemId: z.string().min(1) }),
  'library.workspace': z.object({ botId, path: z.string().max(4096).default('') }),
  'bots.list': z.object({}),
  'bots.delete': BotDeleteInput,
  'bots.deleteDefaults.get': z.object({}),
  'bots.deleteDefaults.set': BotDeleteDefaults,
  'activity.setUnread': z.object({ botId, unread: z.boolean() }),
  'bots.get': z.object({ botId }),
  'bots.create': BotCreateInput,
  'bots.update': BotUpdateInput,
  'bots.setPrefs': BotPrefsInput,
  'bots.setPrimary': z.object({ botId }),
  'sections.list': z.object({}),
  'sections.create': z.object({ name: sectionName }),
  'sections.rename': z.object({ sectionId: z.string().min(1), name: sectionName }),
  'sections.delete': z.object({ sectionId: z.string().min(1) }),
  'models.list': z.object({}),
  /** Everything the bot can see in memory, and whether the bot is connected to it. */
  'memory.list': z.object({ botId }),
  /** The user adds a fact from the app. */
  'memory.write': MemoryWriteInput,
  'memory.forget': z.object({ factId: z.string().min(1) }),
  /** Brings a forgotten fact back. */
  'memory.restore': z.object({ factId: z.string().min(1) }),
  /** Switches a fact off (kept, not shown to bots) or back on. */
  'memory.pause': z.object({ factId: z.string().min(1), paused: z.boolean() }),
  /** Connects a bot to LilBot's memory and brings over the notes its engine kept. */
  'memory.connect': z.object({ botId }),
  /** Without `chatId`: the bot's main conversation, the same one on every device. */
  'chat.history': z.object({ botId, cursor: z.string().max(2000).optional(), limit: z.number().int().min(1).max(100).default(100) }),
  'chat.open': z.object({ botId, chatId: chatId.optional() }),
  /** Starts a new session and makes it the bot's main conversation. */
  'chat.new': z.object({ botId }),
  'chat.send': z
    .object({
      chatId,
      text: z.string().trim().max(200_000),
      attachmentIds: z.array(z.string().uuid()).max(10).optional(),
      messageId: z.string().uuid().optional(),
      /** The device the message is sent from; bots are told where it came from. */
      deviceId: DeviceId.optional()
    })
    .refine(
      p => (p.text.length > 0 || (p.attachmentIds?.length ?? 0) > 0) && (!p.attachmentIds?.length || !!p.messageId),
      'Provide text or attachments, and a messageId for attachments.'
    ),
  'chat.stop': z.object({ chatId }),
  'chat.close': z.object({ chatId }),
  /** LilBot's own connections, such as its T3 Code sign-in for coding. Never returns credentials. */
  'connections.status': z.object({})
} as const

export type Method = keyof typeof methods
export type Params<M extends Method> = z.input<(typeof methods)[M]>

export interface Results {
  'attachments.limits': { maxFileBytes: number; maxFilesPerMessage: number }
  'attachments.prepare': import('./attachment-schema').Attachment[]
  'attachments.status': import('./attachment-schema').Attachment[]
  'deploy.status': import('./deploy-schema').DeploymentStatus
  'threads.list': import('./thread-schema').BotThread[]
  'threads.open': import('./thread-schema').BotThread
  /** Oscar stops an exchange under way; recorded as stopped by Oscar. */
  'threads.cancel': import('./thread-schema').BotThread
  'computers.list': import('./computer-schema').Computer[]
  /** `helperUrl`: the helper door origin for the command, when the server has `LILBOT_HELPER_URL`. */
  'computers.installCode': { code: string; expiresAt: number; helperUrl?: string }
  'computers.remove': { ok: true }
  'computers.setMain': { ok: true }
  'devices.current': import('./device-schema').Device
  'devices.rename': import('./device-schema').Device
  'devices.linkComputer': import('./device-schema').Device
  'computers.addThis.start': import('./computer-add-schema').AddThisStart
  'computers.addThis.status': import('./computer-add-schema').AddThisStatus
  'skills.list': import('./skills-schema').Skill[]
  'skills.read': Record<string, string>
  'skills.setEnabled': { ok: true }
  'skills.engines': import('./skills-schema').SkillEngine[]
  'skills.setEngine': { ok: true }
  'routines.list': Routine[]
  'routines.pause': { ok: true }
  'routines.resume': { ok: true }
  'routines.delete': { ok: true }
  'routines.openRun': ChatSnapshot
  'library.list': LibraryPage
  'library.content': { url: string }
  'library.workspace': WorkspaceEntry[]
  'bots.list': Bot[]
  'bots.delete': { ok: true }
  'bots.deleteDefaults.get': import('./bot-delete-schema').BotDeleteDefaults
  'bots.deleteDefaults.set': import('./bot-delete-schema').BotDeleteDefaults
  'activity.setUnread': { ok: true }
  'bots.get': BotDetail
  'bots.create': Bot
  'bots.update': BotDetail
  'bots.setPrimary': { ok: true }
  'bots.setPrefs': Bot
  'sections.list': Section[]
  'sections.create': Section
  'sections.rename': Section
  'sections.delete': { ok: true }
  'models.list': ModelProvider[]
  'memory.list': { connected: boolean; botName?: string; facts: MemoryFact[]; forgotten: MemoryFact[] }
  'memory.write': MemoryFact
  'memory.forget': { ok: true }
  'memory.restore': { ok: true }
  'memory.pause': { ok: true }
  'memory.connect': { imported: number }
  'chat.history': import('./history-schema').HistoryPage
  'chat.open': ChatSnapshot
  'chat.new': ChatSnapshot
  'chat.send': { ok: true; message?: import('./attachment-schema').AttachmentMessage }
  'chat.stop': { ok: true }
  'chat.close': { ok: true }
  'connections.status': import('./connections-schema').ConnectionsStatus
}

export const RequestFrame = z.object({ id: z.number(), method: z.string(), params: z.unknown() })

export type ResponseFrame = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: { code: string; message: string } }

/** What the server sends without being asked. `bots.changed` means: fetch the bot list again
 *  (a bot, its preferences or the sections changed, here or on another device). `memory.changed`
 *  means a fact was saved or forgotten, by a bot or in the app. */
export type EventFrame =
  | { event: 'chat'; chatId: string; data: ChatEvent }
  | { event: 'bots.changed' }
  | { event: 'memory.changed' }
  | { event: 'routines.changed' }
  | { event: 'library.changed'; botId: string }
  | { event: 'skills.changed' }
  | { event: 'threads.changed' }
  | { event: 'history.changed'; botId: string }
  /** A connection's state changed (for example T3 Code refused LilBot's sign-in). */
  | { event: 'connections.changed' }
  | { event: 'computers.changed' }
  /** A device was renamed or tied to a computer (here or in another tab): fetch `devices.current` again. */
  | { event: 'devices.changed' }

/** An error whose message is safe and useful to show to the user. */
export class LilBotError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}
