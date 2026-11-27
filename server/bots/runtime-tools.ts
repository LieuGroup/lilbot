/** What LilBot gives every bot's runtime besides its identity: the shared skills and
 *  LilBot's own MCP connections. The engine skips what it has already applied. */
import { backgroundFailure } from '../background'
import type { BotEngine, SkillConnection, TurnOrigin } from '../engines/bot-engine'
import type { EngineRegistry } from '../engines/engine-registry'
import type { McpConnection } from '../engines/mcp-connection'
import { files } from '../skills/skill-files'
import type { SkillsService } from '../skills/skills-service'
import type { BotRuntimes } from './bot-runtimes'
import type { BotRecord } from './bot-store'

export interface BotPromptSource {
  enabled: boolean
  write: (bot: BotRecord) => string
  pathFor: (botId: string) => string
  /** A line LilBot adds to every turn while it owns the prompt (today's date, which the cached prompt cannot carry). */
  turnLine?: () => string
}

export interface RuntimeOptions {
  changed?: () => void
  retryDelays?: readonly number[]
  headStartMs?: number
  prepareRetryMs?: number
  now?: () => number
  systemNote?: (bot: BotRecord) => string
  prompt?: BotPromptSource
  onConnectionsChanged?: (botId: string) => void
}

const INITIAL_PREPARE_RETRY_MS = 30_000
const MAX_PREPARE_RETRY_MS = 600_000

/** Tracks one-time runtime preparation per bot, plus bounded exponential backoff when a non-fatal cleanup requests a retry. */
export class PrepareTracker {
  private done = new Set<string>()
  private retry = new Map<string, { at: number; delay: number }>()
  private inFlight = new Map<string, Promise<void>>()
  constructor(
    private initialDelayMs = INITIAL_PREPARE_RETRY_MS,
    private now: () => number = Date.now
  ) {}

  hasPending(botId: string) {
    return this.retry.has(botId)
  }
  markDone(botId: string) {
    this.retry.delete(botId)
    this.done.add(botId)
  }
  clear(botId: string) {
    this.done.delete(botId)
    this.retry.delete(botId)
  }
  run(botId: string, prepare: () => Promise<{ retry?: boolean } | undefined>): Promise<void> {
    if (this.done.has(botId)) return Promise.resolve()
    const active = this.inFlight.get(botId)
    if (active) return active
    const next = this.retry.get(botId)
    if (next && this.now() < next.at) return Promise.resolve()
    const promise = prepare()
      .then(result => {
        if (result?.retry) {
          const delay = next ? Math.min(next.delay * 2, MAX_PREPARE_RETRY_MS) : this.initialDelayMs
          this.retry.set(botId, { at: this.now() + delay, delay })
        } else {
          this.markDone(botId)
        }
      })
      .finally(() => this.inFlight.delete(botId))
    this.inFlight.set(botId, promise)
    return promise
  }
}

interface ToolSources {
  skills?: SkillsService
  connection?: SkillConnection
  connections?: (botId: string) => McpConnection[]
  prompt?: BotPromptSource
  onConnectionsChanged?: (botId: string) => void
}

export interface PromptRuntimeStatus {
  promptActive?: boolean
  promptFallback?: string
}

/** Adds LilBot's per-turn line (today's date while it owns the prompt) right after the turn's origin line. */
export function withTurnLine<T extends { origin?: TurnOrigin }>(options: T, prompt?: BotPromptSource): T
export function withTurnLine<T extends { origin?: TurnOrigin }>(options: T | undefined, prompt?: BotPromptSource): T | undefined
export function withTurnLine<T extends { origin?: TurnOrigin }>(options: T | undefined, prompt?: BotPromptSource): T | undefined {
  const line = prompt?.turnLine?.()
  if (!line) return options
  return { ...options, origin: { ...options?.origin, line: [options?.origin?.line, line].filter(Boolean).join('\n') } } as T
}

/** The last fallback reason logged per bot, so a bot that stays on the engine's prompt is logged once, not on every use. */
const logged = new Map<string, string>()
function noteFallback(botId: string, reason: string | undefined) {
  if (logged.get(botId) === reason) return
  if (reason) console.error(`[prompt] owned prompt not in use; the engine's own prompt answers (${reason})`)
  if (reason) logged.set(botId, reason)
  else logged.delete(botId)
}

async function applyPromptFailSafe(engine: BotEngine, bot: BotRecord, prompt?: BotPromptSource): Promise<PromptRuntimeStatus> {
  if (!prompt || !engine.configurePrompt) return {}
  if (!prompt.enabled) {
    try {
      await engine.configurePrompt(bot.engineBotId, { enabled: false, botId: bot.id, promptFile: prompt.pathFor(bot.id) })
    } catch {
      console.error('[prompt] could not disable owned prompt on engine; continuing with current setup')
    }
    return { promptActive: false }
  }
  try {
    const promptFile = prompt.write(bot)
    const applied = await engine.configurePrompt(bot.engineBotId, { enabled: true, botId: bot.id, promptFile })
    const reason = applied.active ? undefined : (applied.reason ?? 'engine prompt middleware inactive').slice(0, 80)
    noteFallback(bot.id, reason)
    return reason ? { promptActive: false, promptFallback: reason } : { promptActive: true }
  } catch {
    noteFallback(bot.id, 'prompt setup failed')
    return { promptActive: false, promptFallback: 'prompt setup failed' }
  }
}

/** The runtime state with the prompt status read again, so a plug-in that fell back mid-session shows on the next look. */
export async function withFreshPrompt(runtimes: Pick<BotRuntimes, 'snapshot' | 'restoreState' | 'engineFor' | 'options'>, bot: BotRecord) {
  const state = runtimes.snapshot(bot)
  if (!state || !runtimes.options.prompt?.enabled) return state
  const { promptActive: _active, promptFallback: _fallback, ...rest } = state
  const fresh = { ...rest, ...(await applyPromptFailSafe(runtimes.engineFor(bot), bot, runtimes.options.prompt)) }
  runtimes.restoreState(bot.id, fresh)
  return fresh
}

export async function prepareTools(
  engine: BotEngine,
  bot: BotRecord,
  { skills, connection, connections, prompt, onConnectionsChanged }: ToolSources
): Promise<PromptRuntimeStatus> {
  if (skills && connection) {
    // An engine whose switch is off is not imported from; the bot is marked only after an import, so switching on imports it.
    const includeEngineSkills = skills.engineIncluded(engine.id)
    if (includeEngineSkills && !skills.importedBot(bot.id)) {
      for (const path of engine.userSkillPaths?.(bot.engineBotId) ?? []) skills.import(engine.id, path, files(path))
      skills.markBotImported(bot.id)
    }
    await engine.configureSkills?.(bot.engineBotId, {
      root: skills.root,
      ...connection,
      botId: bot.id,
      disabled: skills.disabled(bot.id),
      names: skills.list(bot.id).map(s => s.name),
      includeEngineSkills
    })
  }
  const given = connections?.(bot.id)
  if (given?.length && (await engine.prepareConnections?.(bot.engineBotId, given))) onConnectionsChanged?.(bot.id)
  return applyPromptFailSafe(engine, bot, prompt)
}

/** Gives each bot its connections again, for example after a connection or sign-in changed. */
export async function refreshConnections(engines: EngineRegistry, bots: BotRecord[], connections: (botId: string) => McpConnection[], onChanged?: (botId: string) => void) {
  let failed = false
  for (const bot of bots) {
    const engine = engines.get(bot.engineId)
    if (!engine) continue
    try {
      if (await engine.prepareConnections?.(bot.engineBotId, connections(bot.id))) onChanged?.(bot.id)
    } catch {
      backgroundFailure('bot connections')
      failed = true
    }
  }
  if (failed) throw new Error('Connection refresh incomplete')
}
