/** Wires the leader-side `RemoteWorkerRunner` to LilBot's database, computers, bots, memory, skills, and scoped MCP server.
 *  Also validates remote worker targets (`resolveRemoteWorker`) and dispatches remote worker turns (`runForBot`). */
import type { Database } from 'bun:sqlite'
import type { BotModel, ReasoningEffort } from '../shared/bot-schema'
import { LilBotError } from '../shared/lilbot-error'
import type { BotRecord, BotStore } from './bots/bot-store'
import { withNote } from './bots/system-note'
import type { ComputerService } from './computers/computer-service'
import { assembleRemoteWorkerPrompt } from './computers/remote-worker-prompt'
import { RemoteWorkerRunner } from './computers/remote-worker-runner'
import { validateRemoteCwd, validateRemoteModel } from './computers/remote-worker-sanitize'
import type { RemoteWorkerResult } from './computers/remote-worker-store'
import type { RemoteWorkerMcpContext } from './computers/remote-worker-types'
import type { MemoryService } from './memory/memory-service'
import type { SkillsService } from './skills/skills-service'
import type { RemoteTarget } from './threads/delegation-remote'

interface RemoteWorkerAppDeps {
  database: Database
  computers: ComputerService
  store: BotStore
  memory: MemoryService
  skills: SkillsService
  systemNote: (bot: BotRecord) => string
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

  const buildSystemPrompt = (bot: BotRecord, computerName: string, cwd: string) => {
    const offered = deps.skills.offered(bot.id)
    let codingSkillBody: string | undefined
    if (offered.some(s => s.name === 'lilbot-coding')) {
      try {
        codingSkillBody = deps.skills.read('lilbot-coding')['SKILL.md']
      } catch {}
    }
    return assembleRemoteWorkerPrompt({
      instructionsWithNote: withNote(bot.instructions, deps.systemNote(bot)),
      computerName,
      cwd,
      memoryBlock: deps.memory.contextBlock(bot.id).text,
      skills: offered.map(s => ({ name: s.name, description: s.description })),
      codingSkillBody
    })
  }

  const resolveRemoteWorker = async (callerId: string, opts: { computer: string; cwd?: string; model?: BotModel; continuation?: boolean }): Promise<RemoteTarget | null> => {
    const all = deps.computers.list()
    const matches = all.filter(c => c.id === opts.computer || c.name === opts.computer)
    if (matches.length === 0) throw new LilBotError('computer_not_found', `Computer "${opts.computer}" not found. Check lilbot_status (area computers).`)
    if (matches.length > 1) throw new LilBotError('computer_ambiguous', `More than one computer is named "${opts.computer}". Use its id from lilbot_status (area computers).`)
    const found = matches[0]
    if (found.id === 'leader') {
      if (opts.cwd) throw new LilBotError('invalid_cwd', 'cwd applies only to remote computers; leader workers run in your workspace.')
      return null
    }
    if (found.keyConflict) throw new LilBotError('computer_offline', `Computer "${found.name}" has a key conflict and cannot run workers until re-registered.`)
    if (!found.online) throw new LilBotError('computer_offline', `Computer "${found.name}" is offline. Wait until it is back online or tell Oscar.`)
    const agents = found.workerAgents ?? []
    if (!found.capabilities.includes('worker') || !agents.length) throw new LilBotError('computer_no_worker', `Computer "${found.name}" does not advertise a coding agent.`)
    if (!opts.continuation) {
      const cwdCheck = validateRemoteCwd(opts.cwd ?? '')
      if (!cwdCheck.ok) throw new LilBotError('invalid_cwd', cwdCheck.message)
    }
    const bot = deps.store.get(callerId)
    const modelCheck = validateRemoteModel(opts.model ?? bot.model, agents)
    if (!modelCheck.ok) throw new LilBotError('invalid_model', modelCheck.message)
    return { computerId: found.id, computerName: found.name, cwd: opts.cwd }
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
      model?: BotModel
      reasoningEffort?: ReasoningEffort
      onChat: (chatId: string) => void
    }
  ): Promise<RemoteWorkerResult> => {
    const bot = deps.store.get(botId)
    const comp = deps.computers.list().find(c => c.id === options.computer)
    const agents = comp?.workerAgents ?? []
    const modelCheck = validateRemoteModel(options.model ?? bot.model, agents.length ? agents : [{ driver: 'claude-code', version: '0' }])
    if (!modelCheck.ok) return { status: 'failed', text: modelCheck.message, items: [], failureReason: 'invalid_start' }
    const built = buildSystemPrompt(bot, comp?.name ?? options.computer, options.cwd)
    if (!built.ok) return { status: 'failed', text: built.error, items: [], failureReason: 'prompt_too_large' }
    const effort = options.reasoningEffort ?? (!options.model ? (bot.reasoningEffort ?? undefined) : undefined)
    const chatId = options.chatId ?? `remote:${options.threadId}`
    return runner.run({
      runId: options.runId,
      computerId: options.computer,
      botId,
      threadId: options.threadId,
      chatId,
      cwd: options.cwd,
      model: modelCheck.wireModel,
      driver: modelCheck.driver,
      ...(effort ? { reasoningEffort: effort } : {}),
      systemPrompt: built.systemPrompt,
      prompt,
      onChat: options.onChat
    })
  }

  const computerName = (computerId: string) => deps.computers.list().find(c => c.id === computerId)?.name

  return { runner, buildSystemPrompt, resolveRemoteWorker, runForBot, computerName }
}

export type RemoteWorkers = ReturnType<typeof createRemoteWorkers>
