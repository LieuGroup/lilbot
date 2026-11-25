/** What LilBot gives every bot's runtime besides its identity: the shared skills and
 *  LilBot's own MCP connections. The engine skips what it has already applied. */
import { backgroundFailure } from '../background'
import type { BotEngine, SkillConnection } from '../engines/bot-engine'
import type { EngineRegistry } from '../engines/engine-registry'
import type { McpConnection } from '../engines/mcp-connection'
import { files } from '../skills/skill-files'
import type { SkillsService } from '../skills/skills-service'
import type { BotRecord } from './bot-store'

export interface BotPromptSource {
  enabled: boolean
  write: (bot: BotRecord) => string
  pathFor: (botId: string) => string
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
    if (applied.active) return { promptActive: true }
    const reason = applied.reason || 'engine prompt middleware inactive'
    console.error('[prompt] owned prompt inactive; falling back to engine prompt')
    return { promptActive: false, promptFallback: reason }
  } catch {
    console.error('[prompt] owned prompt setup failed; falling back to engine prompt')
    return { promptActive: false, promptFallback: 'prompt setup failed' }
  }
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
