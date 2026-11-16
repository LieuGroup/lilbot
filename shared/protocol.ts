/** The browser <-> LeBot server protocol: JSON frames over one WebSocket. */
import { z } from 'zod'

import { type Bot, BotCreateInput, type BotDetail, BotUpdateInput, type ModelProvider } from './bot-schema'
import type { ChatEvent, ChatSnapshot } from './chat-schema'

/** Each method's params schema (checked on the server) and result type (trusted by the browser). */
export const methods = {
  'bots.list': z.object({}),
  'bots.get': z.object({ botId: z.string().min(1) }),
  'bots.create': BotCreateInput,
  'bots.update': BotUpdateInput,
  'models.list': z.object({}),
  'chat.open': z.object({ botId: z.string().min(1), chatId: z.string().min(1).nullable() }),
  'chat.send': z.object({ chatId: z.string().min(1), text: z.string().trim().min(1).max(200_000) }),
  'chat.stop': z.object({ chatId: z.string().min(1) }),
  'chat.close': z.object({ chatId: z.string().min(1) })
} as const

export type Method = keyof typeof methods
export type Params<M extends Method> = z.input<(typeof methods)[M]>

export interface Results {
  'bots.list': Bot[]
  'bots.get': BotDetail
  'bots.create': Bot
  'bots.update': BotDetail
  'models.list': ModelProvider[]
  'chat.open': ChatSnapshot
  'chat.send': { ok: true }
  'chat.stop': { ok: true }
  'chat.close': { ok: true }
}

export const RequestFrame = z.object({ id: z.number(), method: z.string(), params: z.unknown() })

export type ResponseFrame = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: { code: string; message: string } }

export type EventFrame = { event: 'chat'; chatId: string; data: ChatEvent }

/** An error whose message is safe and useful to show to the user. */
export class LeBotError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}
