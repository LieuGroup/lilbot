/** The local HTTP endpoint engine adapters use to reach LilBot's memory (today: the Hermes memory
 *  provider in `engines/hermes/memory-adapter/`). Only for programs on this machine: it answers on
 *  the loopback address only, refuses browsers, and needs the token from LilBot's data folder. */

import { timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { type MemoryFact, MemoryKind, MemoryScope } from '../../shared/memory-schema'
import { LilBotError } from '../../shared/protocol'
import { matchesCapability } from '../bots/bot-capability'
import { BotCreationInput } from '../bots/bot-creation'
import type { BotService } from '../bots/bot-service'
import type { MemoryReviewer } from '../memory/memory-reviewer'
import { type MemoryService, shortId } from '../memory/memory-service'

const botId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)

/** The chat the call comes from, as the engine names it. */
const chatId = z.string().min(1).max(200).optional()
/** A date like 2026-12-31: the fact is shown until the end of that day (UTC). */
const expires = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31.')
  .optional()

const routes = {
  '/engine/memory/context': z.object({ botId, chatId }),
  '/engine/memory/recall': z.object({ botId, chatId, query: z.string().max(500).default(''), kind: MemoryKind.optional(), limit: z.number().int().optional() }),
  '/engine/memory/write': z.object({ botId, chatId, kind: MemoryKind, scope: MemoryScope.optional(), text: z.string(), expires }),
  '/engine/memory/forget': z.object({ botId, chatId, id: z.string().min(4).max(64) }),
  /** A finished turn, for the after-chat review. */
  '/engine/memory/turn': z.object({ botId, chatId: z.string().min(1).max(200), user: z.string().max(200_000), assistant: z.string().max(200_000) })
} as const

/** Reads the token, creating it (readable by the user only) on first start. */
export function engineToken(dataDir: string): string {
  const path = join(dataDir, 'engine-token')
  if (!existsSync(path)) writeFileSync(path, crypto.randomUUID() + crypto.randomUUID(), { mode: 0o600 })
  chmodSync(path, 0o600)
  return readFileSync(path, 'utf8').trim()
}

/** A fact as a bot reads it: short id, date, and who it came from when another bot shared it. */
const forBot = (fact: MemoryFact, reader: string) => ({
  id: shortId(fact),
  kind: fact.kind,
  scope: fact.scope,
  text: fact.text,
  date: new Date(fact.learnedAt).toISOString().slice(0, 10),
  ...(fact.expiresAt ? { until: new Date(fact.expiresAt).toISOString().slice(0, 10) } : {}),
  ...(fact.botId !== reader ? { from: fact.botId } : {})
})

const json = (status: number, body: unknown) => Response.json(body, { status })

export interface EngineApiOptions {
  bots?: BotService
  botExists?: (botId: string) => boolean
  onMemoryChanged?: () => void
  /** The adapter version this LilBot ships. A bot calling with another one runs stale adapter code. */
  adapterVersion?: string
  /** Receives finished turns and knows which chats are reviews. Without it there is no review. */
  reviewer?: MemoryReviewer
}

export function createEngineApi(memory: MemoryService, token: string, port: number, options: EngineApiOptions = {}) {
  const onMemoryChanged = options.onMemoryChanged ?? (() => {})
  const staleBots = new Set<string>()
  const expected = Buffer.from(`Bearer ${token}`)
  const loopback = new Set([`127.0.0.1:${port}`, `localhost:${port}`])

  const authorised = (request: Request) => {
    // A browser always sends Origin on a POST; nothing in a browser may reach this endpoint.
    if (request.headers.has('origin') || !loopback.has(request.headers.get('host')?.toLowerCase() ?? '')) return false
    const given = Buffer.from(request.headers.get('authorization') ?? '')
    return given.length === expected.length && timingSafeEqual(given, expected)
  }

  return async (request: Request, pathname: string): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'Use POST.' })
    if (!authorised(request)) return json(403, { error: 'Not allowed.' })
    if (pathname === '/engine/bots/create') {
      try {
        const capability = request.headers.get('x-lilbot-bot-capability') ?? ''
        const caller = (await options.bots?.listBots())?.find(bot => matchesCapability(token, bot.id, capability))
        if (!caller || !options.bots) return json(403, { error: 'Unknown bot credential.' })
        const input = BotCreationInput.safeParse(await request.json())
        if (!input.success) return json(400, { error: 'Invalid bot creation request.' })
        return json(200, await options.bots.createFromBot(caller.id, input.data))
      } catch (error) {
        return json(error instanceof LilBotError ? 422 : 500, { error: error instanceof Error ? error.message : 'Creation failed.' })
      }
    }
    if (!Object.hasOwn(routes, pathname)) return json(404, { error: 'Unknown endpoint.' })

    try {
      const route = pathname as keyof typeof routes
      const parsed = routes[route].safeParse(await request.json().catch(() => null))
      if (!parsed.success) return json(400, { error: `Invalid request: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` })
      const body = parsed.data as any
      if (options.botExists && !options.botExists(body.botId)) return json(404, { error: 'This bot was deleted.' })
      const version = request.headers.get('x-lilbot-adapter-version')
      if (options.adapterVersion && version !== options.adapterVersion && !staleBots.has(body.botId)) {
        staleBots.add(body.botId)
        console.error(`[engine-api] bot ${body.botId} runs memory adapter ${version ?? 'unknown'}, LilBot ships ${options.adapterVersion}. Reconnect it and restart the engine.`)
      }

      switch (route) {
        case '/engine/memory/context':
          return json(200, memory.contextBlock(body.botId))
        case '/engine/memory/recall':
          return json(200, { facts: memory.recall(body.botId, body.query, { kind: body.kind, limit: body.limit }).map(fact => forBot(fact, body.botId)) })
        case '/engine/memory/write': {
          const review = options.reviewer?.isReview(body.chatId) ?? false
          const fact = memory.write({
            botId: body.botId,
            kind: body.kind,
            scope: body.scope,
            text: body.text,
            author: 'bot',
            via: review ? 'review' : 'chat',
            sourceChatId: body.chatId,
            // Shown through the whole named day.
            expiresAt: body.expires ? Date.parse(`${body.expires}T23:59:59Z`) : undefined
          })
          onMemoryChanged()
          const notice = memory.overflowNotice(body.botId)
          return json(200, { saved: forBot(fact, body.botId), ...(notice ? { notice } : {}) })
        }
        case '/engine/memory/forget': {
          const fact = memory.forgetAsBot(body.botId, body.id, { review: options.reviewer?.isReview(body.chatId) ?? false })
          onMemoryChanged()
          return json(200, { forgotten: forBot(fact, body.botId) })
        }
        case '/engine/memory/turn':
          options.reviewer?.record(body.botId, body.chatId, body.user, body.assistant)
          return json(200, { ok: true })
      }
    } catch (error) {
      // A refusal the bot can act on (unknown id, fact too long) is returned as its tool result.
      if (error instanceof LilBotError) return json(422, { error: error.message })
      console.error('[engine-api] request failed:', error instanceof Error ? error.message : error)
      return json(500, { error: 'LilBot could not handle the memory request.' })
    }
  }
}
