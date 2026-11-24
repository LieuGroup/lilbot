/** The local HTTP endpoint engine adapters use to reach LilBot's memory (today: the Hermes memory
 *  provider in `engines/hermes/memory-adapter/`). Only for programs on this machine: it answers on
 *  the loopback address only, refuses browsers, and needs the token from LilBot's data folder. */

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
import type { CheckpointStore } from '../memory/memory-checkpoint-store'
import type { MemoryReviewer } from '../memory/memory-reviewer'
import type { MemoryService } from '../memory/memory-service'
import type { RoutineService } from '../routines/routine-service'
import type { SystemChanges } from '../system/system-changes'
import { withoutWebhookNotes } from '../webhooks/webhook-messages'
import type { CheckUse } from '../work/check-sessions'
import { bodyChatId, checkUse, headerSession, verifiedSession } from './engine-run-gate'
import { historyApi } from './history-api'
import { memoryRoutes as routes } from './memory-protocol'
import { routineApi } from './routine-api'
import { skillApi } from './skill-api'
import { threadApi } from './thread-api'

const RETIRED_TOOL_ROUTES: Readonly<Record<string, string>> = {
  '/engine/memory/recall': 'Legacy memory plug-in tools are retired. Use the LilBot System MCP tool lilbot_memory_recall instead.',
  '/engine/memory/write': 'Legacy memory plug-in tools are retired. Use the LilBot System MCP tool lilbot_memory_save instead.',
  '/engine/memory/forget': 'Legacy memory plug-in tools are retired. Use the LilBot System MCP tool lilbot_memory_forget instead.',
  '/engine/history/search': 'Legacy conversation search plug-in tool is retired. Use the LilBot System MCP tool lilbot_history_search instead.'
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
  deploymentNotice?: () => string | undefined
  threads?: import('../threads/thread-service').ThreadService
  skills?: import('../skills/skills-service').SkillsService
  changes?: SystemChanges
  bots?: BotService
  routines?: RoutineService
  library?: LibraryService
  botExists: (botId: string) => boolean
  onMemoryChanged?: () => void
  adapterVersion?: string
  reviewer?: MemoryReviewer
  checkpointStore?: CheckpointStore
  chatKind?: import('../bots/hidden-chats').ChatKind
  inCheck?: (botId: string, chatId: string | undefined, use: CheckUse) => string | null
  memoryLocked?: (botId: string, chatId: string | undefined) => string | null
  skillWriteLocked?: (botId: string, chatId: string | undefined) => string | null
  sessionCapabilities?: (botId: string, chatId: string | undefined) => WebhookCapability[] | null
  pluginRefusal?: (botId: string, pathname: string, body: unknown, session: string | undefined) => string | null | Promise<string | null>
}

export function createEngineApi(memory: MemoryService, token: string, port: number, options: EngineApiOptions) {
  const history = historyApi(options, memory)
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
    if (pathname.startsWith('/engine/computers/')) {
      return json(410, {
        error:
          'Legacy computer plug-in tools are retired. Use the LilBot System MCP tools (lilbot_computers_list, lilbot_computer_exec, lilbot_computer_read_file, lilbot_computer_write_file, lilbot_computer_list_folder, lilbot_computer_request_read, lilbot_computer_cancel, lilbot_computer_copy) instead.'
      })
    }
    if (Object.hasOwn(RETIRED_TOOL_ROUTES, pathname)) {
      return json(410, { error: RETIRED_TOOL_ROUTES[pathname] })
    }
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
    if (!Object.hasOwn(routes, pathname)) return json(404, { error: 'Unknown endpoint.' })

    try {
      const route = pathname as keyof typeof routes
      const parsed = routes[route].safeParse(await request.json().catch(() => null))
      if (!parsed.success) return json(400, { error: `Invalid request: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` })
      const body = parsed.data as any
      if (!options.botExists(body.botId)) return json(404, { error: 'This bot does not exist.' })
      const version = request.headers.get('x-lilbot-adapter-version')
      if (options.adapterVersion && version !== options.adapterVersion && !staleBots.has(body.botId)) {
        staleBots.add(body.botId)
        console.error(`[engine-api] bot ${body.botId} runs memory adapter ${version ?? 'unknown'}, LilBot ships ${options.adapterVersion}. Reconnect it and restart the engine.`)
      }
      const session = verifiedSession(request, body.chatId)
      const refused = route !== '/engine/memory/turn' && (options.inCheck?.(body.botId, session, 'memory') || options.memoryLocked?.(body.botId, session))
      if (refused) return route === '/engine/memory/context' ? json(200, { text: '', shown: 0, total: 0 }) : json(422, { error: refused })
      switch (route) {
        case '/engine/memory/context': {
          const context = memory.contextBlock(body.botId)
          const notice = options.deploymentNotice?.()
          return json(200, { ...context, text: [context.text, notice && `LilBot deployment status: ${notice}`].filter(Boolean).join('\n\n') })
        }
        case '/engine/memory/turn':
          if ((options.chatKind?.(body.botId, body.chatId) ?? 'conversation') === 'conversation')
            options.reviewer?.record(body.botId, body.chatId, withoutWebhookNotes(String(body.user ?? '')), body.assistant)
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
