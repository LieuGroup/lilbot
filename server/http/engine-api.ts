/** The local HTTP endpoint engine adapters use to reach LilBot on this machine. Loopback only, refuses
 *  browsers. `/engine/history/save` authenticates with each bot's per-bot `memory-checkpoint` HMAC bearer
 *  key (with a temporary legacy master-token + bot-capability fallback for already-open v0.15.0 sessions during
 *  deploy rollout, to be removed in the final skills/adapter cleanup PR once sessions rotate). */

import { timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { LibraryGiveInput } from '../../shared/library-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { WebhookCapability } from '../../shared/webhook-schema'
import { matchesCapability } from '../bots/bot-capability'
import { BotCreationInput } from '../bots/bot-creation'
import type { BotService } from '../bots/bot-service'
import type { LibraryService } from '../library/library-service'
import { checkpointCallerFrom } from '../memory/memory-checkpoint-key'
import type { CheckpointStore } from '../memory/memory-checkpoint-store'
import type { MemoryReviewer } from '../memory/memory-reviewer'
import type { MemoryService } from '../memory/memory-service'
import type { RoutineService } from '../routines/routine-service'
import type { SystemChanges } from '../system/system-changes'
import type { CheckUse } from '../work/check-sessions'
import { bodyChatId, checkUse, headerSession, verifiedSession } from './engine-run-gate'
import { historyApi } from './history-api'
import { routineApi } from './routine-api'
import { skillApi } from './skill-api'
import { threadApi } from './thread-api'

const RETIRED_ROUTES: Readonly<Record<string, string>> = {
  '/engine/memory/recall': 'Legacy memory plug-in tools are retired. Use the LilBot System MCP tool lilbot_memory_recall instead.',
  '/engine/memory/write': 'Legacy memory plug-in tools are retired. Use the LilBot System MCP tool lilbot_memory_save instead.',
  '/engine/memory/forget': 'Legacy memory plug-in tools are retired. Use the LilBot System MCP tool lilbot_memory_forget instead.',
  '/engine/history/search': 'Legacy conversation search plug-in tool is retired. Use the LilBot System MCP tool lilbot_history_search instead.',
  '/engine/memory/context': 'Legacy memory context plug-in hook is retired. LilBot delivers memory directly with each turn.',
  '/engine/memory/turn': 'Legacy after-turn review plug-in hook is retired. LilBot queues completed turns directly.'
}

/** Reads the token, creating it (readable by the user only) on first start. */
export function engineToken(dataDir: string): string {
  const path = join(dataDir, 'engine-token')
  if (!existsSync(path)) writeFileSync(path, crypto.randomUUID() + crypto.randomUUID(), { mode: 0o600 })
  chmodSync(path, 0o600)
  return readFileSync(path, 'utf8').trim()
}

const json = (status: number, body: unknown) => Response.json(body, { status })

export interface EngineApiOptions {
  history?: import('../history/history-service').HistoryService
  threads?: import('../threads/thread-service').ThreadService
  skills?: import('../skills/skills-service').SkillsService
  changes?: SystemChanges
  bots?: BotService
  routines?: RoutineService
  library?: LibraryService
  botExists: (botId: string) => boolean
  adapterVersion?: string
  reviewer?: MemoryReviewer
  checkpointStore?: CheckpointStore
  checkpointRefusals?: import('../memory/memory-checkpoint').CheckpointRefusalPolicy
  onCheckpointSaved?: (botId: string, chatId: string) => void
  chatKind?: import('../bots/hidden-chats').ChatKind
  inCheck?: (botId: string, chatId: string | undefined, use: CheckUse) => string | null
  skillWriteLocked?: (botId: string, chatId: string | undefined) => string | null
  sessionCapabilities?: (botId: string, chatId: string | undefined) => WebhookCapability[] | null
  pluginRefusal?: (botId: string, pathname: string, body: unknown, session: string | undefined) => string | null | Promise<string | null>
}

export function createEngineApi(memory: MemoryService, token: string, port: number, options: EngineApiOptions) {
  const history = historyApi(options, memory)
  const staleBots = new Set<string>()
  const expected = Buffer.from(`Bearer ${token}`)
  const loopback = new Set([`127.0.0.1:${port}`, `localhost:${port}`])

  const isLoopback = (request: Request) => !request.headers.has('origin') && loopback.has(request.headers.get('host')?.toLowerCase() ?? '')
  const hasMasterToken = (request: Request) => {
    const given = Buffer.from(request.headers.get('authorization') ?? '')
    return given.length === expected.length && timingSafeEqual(given, expected)
  }

  const warnIfStale = (botId: string, request: Request) => {
    const version = request.headers.get('x-lilbot-adapter-version')
    if (options.adapterVersion && version && version !== options.adapterVersion && !staleBots.has(botId)) {
      staleBots.add(botId)
      console.error(`[engine-api] bot ${botId} runs memory adapter ${version}, LilBot ships ${options.adapterVersion}. Reconnect it and restart the engine.`)
    }
  }

  return async (request: Request, pathname: string): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'Use POST.' })
    if (!isLoopback(request)) return json(403, { error: 'Not allowed.' })

    // Pre-compress checkpoint accepts per-bot `memory-checkpoint` HMAC key (preferred) or legacy master-token + capability.
    if (pathname === '/engine/history/save') {
      try {
        const list = (await options.bots?.listBots()) ?? []
        const auth = request.headers.get('authorization') ?? ''
        let callerId = checkpointCallerFrom(
          token,
          list.map(b => b.id),
          auth
        )
        if (!callerId && hasMasterToken(request)) {
          const capability = request.headers.get('x-lilbot-bot-capability') ?? ''
          callerId = list.find(bot => matchesCapability(token, bot.id, capability))?.id
        }
        if (!callerId || !options.bots || !options.botExists(callerId)) return json(403, { error: 'Unknown bot credential.' })
        warnIfStale(callerId, request)
        const body = await request.json()
        const session = verifiedSession(request, bodyChatId(body))
        const refused = await options.pluginRefusal?.(callerId, pathname, body, session)
        if (refused) return json(422, { error: refused })
        return json(200, await history(callerId, 'save', body))
      } catch (error) {
        if (error instanceof z.ZodError) return json(400, { error: error.message })
        if (error instanceof LilBotError) return json(422, { error: error.message })
        console.error('[engine-api] request failed:', error instanceof Error ? error.message : error)
        return json(500, { error: 'Request failed.' })
      }
    }

    if (!hasMasterToken(request)) return json(403, { error: 'Not allowed.' })
    if (pathname.startsWith('/engine/computers/')) {
      return json(410, {
        error:
          'Legacy computer plug-in tools are retired. Use the LilBot System MCP tools (lilbot_computers_list, lilbot_computer_exec, lilbot_computer_read_file, lilbot_computer_write_file, lilbot_computer_list_folder, lilbot_computer_request_read, lilbot_computer_cancel, lilbot_computer_copy) instead.'
      })
    }
    if (Object.hasOwn(RETIRED_ROUTES, pathname)) return json(410, { error: RETIRED_ROUTES[pathname] })
    if (pathname === '/engine/bots/create' || pathname === '/engine/library/give' || /^\/engine\/(routines|skills|threads|history)\//.test(pathname)) {
      try {
        const capability = request.headers.get('x-lilbot-bot-capability') ?? ''
        const caller = (await options.bots?.listBots())?.find(bot => matchesCapability(token, bot.id, capability))
        if (!caller || !options.bots || !options.botExists(caller.id)) return json(403, { error: 'Unknown bot credential.' })
        const body = await request.json()
        const isSkillWrite = pathname.startsWith('/engine/skills/') && pathname.endsWith('/write')
        const session = isSkillWrite ? headerSession(request, bodyChatId(body)) : verifiedSession(request, bodyChatId(body))
        if (isSkillWrite) {
          const locked = options.skillWriteLocked?.(caller.id, session)
          if (locked) return json(422, { error: locked })
        }
        const refused = await options.pluginRefusal?.(caller.id, pathname, body, session)
        if (refused) return json(422, { error: refused })
        const use = checkUse(pathname)
        const inCheck = use && options.inCheck?.(caller.id, session, use)
        if (inCheck) return json(422, { error: inCheck })
        if (pathname === '/engine/library/give') {
          const input = LibraryGiveInput.safeParse(body)
          if (!input.success) return json(400, { error: 'Invalid file delivery.' })
          if (!options.library) return json(503, { error: 'Library unavailable.' })
          const routineRunId = session ? options.routines?.store.runForChat(caller.id, session) : undefined
          try {
            const item = await options.library.give(caller.id, { ...input.data, ...(session ? { chatId: session } : {}), routineRunId })
            return json(200, { item, url: `/api/library/${caller.id}/${item.id}` })
          } catch {
            return json(422, { error: 'Cannot give this file. Use a regular file inside your workspace, at most 50 MiB.' })
          }
        }
        if (pathname.startsWith('/engine/history/')) return json(200, await history(caller.id, pathname.slice('/engine/history/'.length), body))
        if (pathname.startsWith('/engine/threads/')) return json(200, await threadApi(options, caller.id, pathname.slice('/engine/threads/'.length), body, session))
        if (pathname.startsWith('/engine/skills/')) {
          if (!options.skills) return json(404, { error: 'Skills unavailable.' })
          const reply = skillApi(options.skills, caller, pathname.slice('/engine/skills/'.length), body, options.changes)
          return json(reply.status, reply.body)
        }
        if (pathname.startsWith('/engine/routines/')) {
          if (!options.routines) return json(404, { error: 'Routines are unavailable.' })
          return json(200, await routineApi(options.routines, caller.id, pathname.slice('/engine/routines/'.length), body))
        }
        const input = BotCreationInput.safeParse(body)
        if (!input.success) return json(400, { error: 'Invalid bot creation request.' })
        return json(200, await options.bots.createFromBot(caller.id, input.data))
      } catch (error) {
        if (error instanceof z.ZodError) return json(400, { error: error.message })
        if (error instanceof LilBotError) return json(422, { error: error.message })
        console.error('[engine-api] request failed:', error instanceof Error ? error.message : error)
        return json(500, { error: 'Request failed.' })
      }
    }
    return json(404, { error: 'Unknown endpoint.' })
  }
}
