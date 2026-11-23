/** Wires the leader-side `RemoteWorkerRunner` to LilBot's database, computers, bots, memory, skills, and scoped MCP server.
 *  Also validates remote worker targets (`resolveRemoteWorker`) and dispatches remote worker turns (`runForBot`). */
import type { Database } from 'bun:sqlite'
import type { BotModel, ReasoningEffort } from '../shared/bot-schema'
import { LilBotError } from '../shared/lilbot-error'
import type { WebhookCapability } from '../shared/webhook-schema'
import type { WorkerDriverId } from '../shared/worker-frame-schema'
import type { BotRecord, BotStore } from './bots/bot-store'
import { withoutNote } from './bots/system-note'
import type { ComputerService } from './computers/computer-service'
import { assembleRemoteWorkerPrompt, REMOTE_WORKER_EXCLUDED_SKILLS } from './computers/remote-worker-prompt'
import { RemoteWorkerRunner } from './computers/remote-worker-runner'
import { validateModelForDriver, validateRemoteCwd } from './computers/remote-worker-sanitize'
import { selectRemoteWorkerEngine } from './computers/remote-worker-select'
import type { RemoteWorkerResult } from './computers/remote-worker-store'
import type { RemoteWorkerMcpContext } from './computers/remote-worker-types'
import type { MemoryService } from './memory/memory-service'
import type { SkillsService } from './skills/skills-service'
import type { RemoteTarget } from './threads/delegation-remote'
import type { ThreadStore } from './threads/thread-store'

interface RemoteWorkerAppDeps {
  database: Database
  computers: ComputerService
  store: BotStore
  memory: MemoryService
  skills: SkillsService
  handleMcp: (ctx: RemoteWorkerMcpContext, body: string) => Promise<{ status: number; body: string }>
  computersChanged: () => void
}

export function createRemoteWorkers(deps: RemoteWorkerAppDeps) {
  const runner = new RemoteWorkerRunner({
    db: deps.database,
    botExists: id => deps.store.exists(id),
    isRevoked: id => deps.computers.store.revoked(id),
    handleMcp: deps.handleMcp,
    onCapabilitiesChanged: () => deps.computersChanged()
  })
  deps.computers.onRevoke = id => runner.onRevoke(id)

  const buildSystemPrompt = (bot: BotRecord, computerName: string, cwd: string, capabilities?: WebhookCapability[]) => {
    const offered = deps.skills.offered(bot.id).filter(s => !REMOTE_WORKER_EXCLUDED_SKILLS.has(s.name))
    let codingSkillBody: string | undefined
    if (offered.some(s => s.name === 'lilbot-coding')) {
      try {
        codingSkillBody = deps.skills.read('lilbot-coding')['SKILL.md']
      } catch {}
    }
    return assembleRemoteWorkerPrompt({
      instructions: withoutNote(bot.instructions),
      botName: bot.name,
      botId: bot.id,
      computerName,
      cwd,
      memoryBlock: !capabilities || capabilities.includes('memory') ? deps.memory.contextBlock(bot.id).text : '',
      skills: offered.map(s => ({ name: s.name, description: s.description })),
      codingSkillBody
    })
  }

  const resolveRemoteWorker = async (
    callerId: string,
    opts: { computer: string; cwd?: string; model?: BotModel; engine?: WorkerDriverId; continuation?: boolean }
  ): Promise<RemoteTarget | null> => {
    const all = deps.computers.list()
    const exact = all.find(c => c.id === opts.computer)
    const matches = exact ? [exact] : all.filter(c => c.name === opts.computer)
    if (matches.length === 0) throw new LilBotError('computer_not_found', `Computer "${opts.computer}" not found. Check lilbot_status (area computers).`)
    if (matches.length > 1) throw new LilBotError('computer_ambiguous', `More than one computer is named "${opts.computer}". Use its id from lilbot_status (area computers).`)
    const found = matches[0]
    const bot = deps.store.get(callerId)
    if (found.id === 'leader') {
      if (opts.cwd) throw new LilBotError('invalid_cwd', 'cwd applies only to remote computers; leader workers run in your workspace.')
      if (opts.engine && opts.engine !== bot.engineId)
        throw new LilBotError('engine_unavailable', `Leader workers run on your own engine ("${bot.engineId}"), not "${opts.engine}".`)
      return null
    }
    if (bot.permissionMode !== 'full-access') throw new LilBotError('permission_denied', 'Remote workers require full-access mode.')
    if (found.keyConflict) throw new LilBotError('computer_offline', `Computer "${found.name}" has a key conflict and cannot run workers until re-registered.`)
    if (!found.online) throw new LilBotError('computer_offline', `Computer "${found.name}" is offline. Wait until it is back online or tell Oscar.`)
    const agents = found.workerAgents ?? []
    const pick = selectRemoteWorkerEngine({ computerName: found.name, botEngineId: bot.engineId, agents, requestedEngine: opts.engine, requestedModel: opts.model ?? bot.model })
    if (!pick.ok) throw new LilBotError(pick.code, pick.message)
    if (!opts.continuation) {
      const cwdCheck = validateRemoteCwd(opts.cwd ?? '')
      if (!cwdCheck.ok) throw new LilBotError('invalid_cwd', cwdCheck.message)
    }
    const fallbackNote = pick.fallback ? `Your engine (${pick.fallbackFrom}) is not available on "${found.name}", so LilBot fell back to ${pick.driver}.` : undefined
    const modelCheck = validateModelForDriver(opts.model ?? bot.model, pick.driver, fallbackNote)
    if (!modelCheck.ok) throw new LilBotError('invalid_model', modelCheck.message)
    return { computerId: found.id, computerName: found.name, cwd: opts.cwd, engine: pick.driver, ...(pick.fallback ? { fallbackFrom: pick.fallbackFrom } : {}) }
  }

  const runForBot = async (
    botId: string,
    prompt: string,
    options: {
      runId: string
      threadId: string
      chatId?: string
      computer: string
      cwd: string
      engine?: WorkerDriverId
      model?: BotModel
      reasoningEffort?: ReasoningEffort
      capabilities?: WebhookCapability[]
      onChat: (chatId: string) => void
    }
  ): Promise<RemoteWorkerResult> => {
    const existing = runner.store.get(options.runId)
    if (existing?.status === 'settled' && existing.outcome) {
      options.onChat(existing.chatId)
      return existing.outcome
    }
    const bot = deps.store.get(botId)
    if (bot.permissionMode !== 'full-access')
      return runner.failRestored(options.runId, { status: 'failed', text: 'Remote workers require full-access mode.', items: [], failureReason: 'invalid_start' })
    if (options.capabilities && !options.capabilities.includes('computers'))
      return runner.failRestored(options.runId, {
        status: 'failed',
        text: 'A narrowed run cannot run a remote worker without the computers capability.',
        items: [],
        failureReason: 'invalid_start'
      })
    const comp = deps.computers.list().find(c => c.id === options.computer)
    if (!comp) return runner.failRestored(options.runId, { status: 'failed', text: 'The computer was removed.', items: [], failureReason: 'computer_removed' })
    const pick = selectRemoteWorkerEngine({
      computerName: comp.name,
      botEngineId: bot.engineId,
      agents: comp.workerAgents ?? [],
      requestedEngine: options.engine,
      requestedModel: options.model ?? bot.model
    })
    if (!pick.ok) return runner.failRestored(options.runId, { status: 'failed', text: pick.message, items: [], failureReason: 'invalid_start' })
    const modelCheck = validateModelForDriver(options.model ?? bot.model, pick.driver)
    if (!modelCheck.ok) return runner.failRestored(options.runId, { status: 'failed', text: modelCheck.message, items: [], failureReason: 'invalid_start' })
    const chatId = options.chatId ?? `remote:${options.threadId}`
    const resumeSession = existing?.sessionId ?? runner.store.latestSession(chatId)
    let systemPrompt: string | undefined
    if (!resumeSession) {
      const built = buildSystemPrompt(bot, comp.name, options.cwd, options.capabilities)
      if (!built.ok) return runner.failRestored(options.runId, { status: 'failed', text: built.error, items: [], failureReason: 'prompt_too_large' })
      systemPrompt = built.systemPrompt
    }
    const effort = options.reasoningEffort ?? (!options.model ? (bot.reasoningEffort ?? undefined) : undefined)
    return runner.run({
      runId: options.runId,
      computerId: options.computer,
      botId,
      threadId: options.threadId,
      chatId,
      ...(resumeSession ? { sessionId: resumeSession } : {}),
      cwd: options.cwd,
      model: modelCheck.wireModel,
      ...(modelCheck.provider ? { provider: modelCheck.provider } : {}),
      driver: modelCheck.driver,
      ...(effort ? { reasoningEffort: effort } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      prompt,
      ...(options.capabilities ? { capabilities: options.capabilities } : {}),
      onChat: options.onChat
    })
  }

  const computerName = (computerId: string) => deps.computers.list().find(c => c.id === computerId)?.name

  return { runner, buildSystemPrompt, resolveRemoteWorker, runForBot, computerName }
}

export type RemoteWorkers = ReturnType<typeof createRemoteWorkers>

/** Routes work-board answers, send-backs, check failures and interrupts for `remote:<threadId>` chats away from Hermes. */
export function remoteWorkAnswers(
  threadStore: ThreadStore,
  deps: () => {
    computerOnline: (computerId: string) => boolean
    oscarAnswer: (threadId: string, id: string, prompt: string) => void
    changed: () => void
    stopByChat: (botId: string, chatId: string) => Promise<boolean>
  }
) {
  return {
    deliver: (threadId: string, runId: string, prompt: string) => {
      try {
        const { computer } = threadStore.get(threadId)
        const d = deps()
        if (!computer || !d.computerOnline(computer)) return false
        d.oscarAnswer(threadId, runId, prompt)
        d.changed()
        return true
      } catch (error) {
        if (error instanceof LilBotError) return false
        throw error
      }
    },
    stop: (botId: string, chatId: string) => deps().stopByChat(botId, chatId)
  }
}
