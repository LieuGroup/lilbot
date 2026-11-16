/** The local HTTP endpoint engine adapters use to reach LeBot's memory (today: the Hermes memory
 *  provider in `engines/hermes/lebot-memory/`). Only for programs on this machine: it answers on
 *  the loopback address only, refuses browsers, and needs the token from LeBot's data folder. */
import { timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import { type MemoryFact, MemoryKind, MemoryScope } from '../shared/memory-schema'
import { LeBotError } from '../shared/protocol'
import { type MemoryService, shortId } from './memory/memory-service'

const botId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)

const routes = {
  '/engine/memory/context': z.object({ botId }),
  '/engine/memory/recall': z.object({ botId, query: z.string().max(500).default(''), kind: MemoryKind.optional(), limit: z.number().int().optional() }),
  '/engine/memory/write': z.object({ botId, kind: MemoryKind, scope: MemoryScope.optional(), text: z.string() }),
  '/engine/memory/forget': z.object({ botId, id: z.string().min(4).max(64) })
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
  ...(fact.botId !== reader ? { from: fact.botId } : {})
})

const json = (status: number, body: unknown) => Response.json(body, { status })

export interface EngineApiOptions {
  onMemoryChanged?: () => void
  /** The adapter version this LeBot ships. A bot calling with another one runs stale adapter code. */
  adapterVersion?: string
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
    if (!Object.hasOwn(routes, pathname)) return json(404, { error: 'Unknown endpoint.' })

    try {
      const route = pathname as keyof typeof routes
      const parsed = routes[route].safeParse(await request.json().catch(() => null))
      if (!parsed.success) return json(400, { error: `Invalid request: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` })
      const body = parsed.data as any
      const version = request.headers.get('x-lebot-adapter-version')
      if (options.adapterVersion && version !== options.adapterVersion && !staleBots.has(body.botId)) {
        staleBots.add(body.botId)
        console.error(`[engine-api] bot ${body.botId} runs memory adapter ${version ?? 'unknown'}, LeBot ships ${options.adapterVersion}. Reconnect it and restart the engine.`)
      }

      switch (route) {
        case '/engine/memory/context':
          return json(200, memory.contextBlock(body.botId))
        case '/engine/memory/recall':
          return json(200, { facts: memory.recall(body.botId, body.query, { kind: body.kind, limit: body.limit }).map(fact => forBot(fact, body.botId)) })
        case '/engine/memory/write': {
          const fact = memory.write({ botId: body.botId, kind: body.kind, scope: body.scope, text: body.text, author: 'bot' })
          onMemoryChanged()
          const notice = memory.overflowNotice(body.botId)
          return json(200, { saved: forBot(fact, body.botId), ...(notice ? { notice } : {}) })
        }
        case '/engine/memory/forget': {
          const fact = memory.forgetAsBot(body.botId, body.id)
          onMemoryChanged()
          return json(200, { forgotten: forBot(fact, body.botId) })
        }
      }
    } catch (error) {
      // A refusal the bot can act on (unknown id, fact too long) is returned as its tool result.
      if (error instanceof LeBotError) return json(422, { error: error.message })
      console.error('[engine-api] request failed:', error instanceof Error ? error.message : error)
      return json(500, { error: 'LeBot could not handle the memory request.' })
    }
  }
}
