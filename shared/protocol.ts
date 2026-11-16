/** The browser <-> LilBot server protocol: JSON frames over one WebSocket. */

import { z } from 'zod'
import { BotDeleteDefaults, BotDeleteInput } from './bot-delete-schema'
import { type Bot, BotCreateInput, type BotDetail, BotPrefsInput, BotUpdateInput, type ModelProvider, type Section, sectionName } from './bot-schema'
import type { ChatEvent, ChatSnapshot } from './chat-schema'
import { type MemoryFact, MemoryWriteInput } from './memory-schema'
import type { Routine } from './routine-schema'

const botId = z.string().min(1)
const chatId = z.string().min(1)

/** Each method's params schema (checked on the server) and result type (trusted by the browser). */
export const methods = {
  'routines.list': z.object({ botId }),
  'routines.pause': z.object({ botId, id: z.string().min(1) }),
  'routines.resume': z.object({ botId, id: z.string().min(1) }),
  'routines.delete': z.object({ botId, id: z.string().min(1) }),
  'routines.openRun': z.object({ botId, runId: z.string().min(1) }),
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
  'chat.open': z.object({ botId, chatId: chatId.optional() }),
  /** Starts a new session and makes it the bot's main conversation. */
  'chat.new': z.object({ botId }),
  'chat.send': z.object({ chatId, text: z.string().trim().min(1).max(200_000) }),
  'chat.stop': z.object({ chatId }),
  'chat.close': z.object({ chatId })
} as const

export type Method = keyof typeof methods
export type Params<M extends Method> = z.input<(typeof methods)[M]>

export interface Results {
  'routines.list': Routine[]
  'routines.pause': { ok: true }
  'routines.resume': { ok: true }
  'routines.delete': { ok: true }
  'routines.openRun': ChatSnapshot
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
  'chat.open': ChatSnapshot
  'chat.new': ChatSnapshot
  'chat.send': { ok: true }
  'chat.stop': { ok: true }
  'chat.close': { ok: true }
}

export const RequestFrame = z.object({ id: z.number(), method: z.string(), params: z.unknown() })

export type ResponseFrame = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: { code: string; message: string } }

/** What the server sends without being asked. `bots.changed` means: fetch the bot list again
 *  (a bot, its preferences or the sections changed, here or on another device). `memory.changed`
 *  means a fact was saved or forgotten, by a bot or in the app. */
export type EventFrame = { event: 'chat'; chatId: string; data: ChatEvent } | { event: 'bots.changed' } | { event: 'memory.changed' } | { event: 'routines.changed' }

/** An error whose message is safe and useful to show to the user. */
export class LilBotError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}
