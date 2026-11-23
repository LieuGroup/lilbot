/** Deliberately simple, model-free BotEngine used as the second-engine proof for the control-plane contract. */
import type { BotModel, ModelProvider } from '../../../shared/bot-schema'
import type { ChatEvent } from '../../../shared/chat-schema'
import { LilBotError } from '../../../shared/lilbot-error'
import type { BotEngine, ChatOptions, MemoryConnection, ReviewOptions, RoutineOptions, RuntimeIdentity, SessionChange, SkillSettings, ToolCallSeen } from '../bot-engine'
import type { McpConnection } from '../mcp-connection'
import { conversationSource, newSession, openScriptedChat, runScriptedTurn, type ScriptedSession, type ScriptedTurnHandler } from './scripted-chat'
import { callMcpServer } from './scripted-mcp'

const DEFAULT_MODELS: ModelProvider[] = [
  {
    provider: 'scripted',
    name: 'Scripted',
    models: ['echo', 'think'],
    capabilities: [
      { id: 'echo', reasoning: false, canDisableReasoning: true },
      { id: 'think', reasoning: true, canDisableReasoning: true }
    ]
  }
]

interface ScriptedRuntime {
  nativeId: string
  identity: RuntimeIdentity
  connections: McpConnection[]
  skills?: SkillSettings
  memoryConnection?: MemoryConnection
  memoryConnected: boolean
}

export interface ScriptedEngineOptions {
  id?: string
  onTurn?: ScriptedTurnHandler
  mcpToolName?: (server: string, tool: string) => string
  models?: ModelProvider[]
}

export class ScriptedEngine implements BotEngine {
  readonly id: string
  readonly supportedPermissionModes = ['full-access'] as const
  private runtimes = new Map<string, ScriptedRuntime>()
  private sessions = new Map<string, ScriptedSession>()
  private routineResults = new Map<string, { status: 'completed' | 'failed' | 'stopped'; text: string; items: ScriptedSession['items'] }>()
  private toolListeners = new Set<(call: ToolCallSeen) => void>()
  private botListeners = new Set<() => void>()
  private nextChat = 0
  private onTurn?: ScriptedTurnHandler
  private models: ModelProvider[]
  readonly mcpToolName: (server: string, tool: string) => string
  readonly routineCalls: { nativeId: string; prompt: string; options: RoutineOptions & ChatOptions }[] = []

  constructor(options: ScriptedEngineOptions = {}) {
    this.id = options.id ?? 'scripted'
    this.onTurn = options.onTurn
    this.models = options.models ?? DEFAULT_MODELS
    this.mcpToolName = options.mcpToolName ?? ((_server, tool) => tool)
  }

  setTurnHandler(handler: ScriptedTurnHandler | undefined) {
    this.onTurn = handler
  }
  runtimeOf(nativeId: string) {
    return this.runtimes.get(nativeId)
  }
  sessionOf(chatId: string) {
    return this.sessions.get(chatId)
  }
  dropSessions() {
    this.sessions.clear()
  }
  importBots = async () => []
  async createRuntime(identity: RuntimeIdentity): Promise<string> {
    const nativeId = `${this.id}-${identity.id}`
    this.runtimes.set(nativeId, { nativeId, identity, connections: [], memoryConnected: false })
    return nativeId
  }
  async applyIdentity(engineBotId: string, identity: RuntimeIdentity) {
    const runtime = this.requireRuntime(engineBotId)
    runtime.identity = identity
    return { abilities: [], memoryConnected: runtime.memoryConnected }
  }
  async deleteRuntime(engineBotId: string) {
    this.runtimes.delete(engineBotId)
    for (const [id, session] of this.sessions) if (session.nativeId === engineBotId) this.sessions.delete(id)
  }
  async prepareConnections(engineBotId: string, connections: McpConnection[]): Promise<boolean> {
    const runtime = this.requireRuntime(engineBotId)
    const before = JSON.stringify(runtime.connections)
    runtime.connections = connections.map(c => ({ ...c, tools: [...c.tools] }))
    return before !== JSON.stringify(runtime.connections)
  }
  async applyConnections(engineBotId: string, chatIds: string[]) {
    this.requireRuntime(engineBotId)
    return chatIds.map(chatId => {
      const s = this.sessions.get(chatId)
      return { chatId, state: !s ? ('not_open' as const) : s.running ? ('busy' as const) : ('applied' as const) }
    })
  }
  async configureSkills(engineBotId: string, settings: SkillSettings) {
    this.requireRuntime(engineBotId).skills = { ...settings, disabled: [...settings.disabled], names: [...settings.names] }
  }
  async validateModel(model: BotModel) {
    if (!this.models.find(p => p.provider === model.provider)?.models.includes(model.model))
      throw new LilBotError('invalid_model', `Unknown model: ${model.provider}::${model.model}`)
  }
  listModels = async () => this.models
  async updateSession(engineBotId: string, chatId: string, change: SessionChange) {
    this.requireRuntime(engineBotId)
    return this.sessions.has(chatId) ? { effort: change.reasoningEffort === undefined ? null : change.reasoningEffort } : null
  }
  async conversations(nativeId: string) {
    this.requireRuntime(nativeId)
    return conversationSource(this.sessions, nativeId)
  }
  async openChat(engineBotId: string, chatId: string | null, options: ChatOptions, onEvent: (event: ChatEvent) => void) {
    this.requireRuntime(engineBotId)
    return openScriptedChat(
      this.sessions,
      (n, w, h) => this.createSession(n, w, h),
      (n, c, t, a, s) => this.callMcp(n, c, t, a, s),
      () => this.onTurn,
      engineBotId,
      chatId,
      options,
      onEvent
    )
  }
  async connectMemory(engineBotId: string, connection: MemoryConnection) {
    const runtime = this.requireRuntime(engineBotId)
    runtime.memoryConnection = connection
    runtime.memoryConnected = true
    return { aboutUser: [], ownNotes: [] }
  }
  refreshMemory = async () => []
  async reviewMemory(engineBotId: string, _prompt: string, options: ReviewOptions) {
    this.requireRuntime(engineBotId)
    options.onChat(this.createSession(engineBotId, '', true).chatId)
  }
  async runRoutine(engineBotId: string, prompt: string, options: RoutineOptions & ChatOptions) {
    this.requireRuntime(engineBotId)
    this.routineCalls.push({ nativeId: engineBotId, prompt, options })
    const cached = this.routineResults.get(options.runId)
    if (cached) return cached
    const session = (options.chatId && this.sessions.get(options.chatId)) || this.createSession(engineBotId, options.workspace, true)
    session.routineOptions = options
    options.onChat(session.chatId)
    const base = options.baseline?.(session.items.length) ?? 0
    const outcome = await runScriptedTurn(
      session,
      { text: prompt, hidden: options.hiddenInput, origin: options.origin, inputId: options.runId },
      (t, a, s) => this.callMcp(engineBotId, session.chatId, t, a, s),
      this.onTurn
    )
    const result = { ...outcome, items: session.items.slice(base) }
    this.routineResults.set(options.runId, result)
    return result
  }
  onBotsChanged = (listener: () => void) => {
    this.botListeners.add(listener)
    return () => void this.botListeners.delete(listener)
  }
  onToolCall = (listener: (call: ToolCallSeen) => void) => {
    this.toolListeners.add(listener)
    return () => void this.toolListeners.delete(listener)
  }
  async stopRun(engineBotId: string, chatId: string) {
    const session = this.sessions.get(chatId)
    if (!session || session.nativeId !== engineBotId || !session.running) return false
    session.controller?.abort()
    return true
  }
  async steerRun(engineBotId: string, chatId: string) {
    const session = this.sessions.get(chatId)
    return session && session.nativeId === engineBotId && session.running ? ('steered' as const) : ('not_running' as const)
  }
  private createSession(nativeId: string, workspace: string, hidden: boolean): ScriptedSession {
    const chatId = `${this.id}-chat-${++this.nextChat}`
    const session = newSession(chatId, nativeId, workspace, hidden, Date.now() + this.nextChat)
    this.sessions.set(chatId, session)
    return session
  }
  private requireRuntime(nativeId: string): ScriptedRuntime {
    const runtime = this.runtimes.get(nativeId)
    if (!runtime) throw new LilBotError('bot_not_found', 'That bot does not exist.')
    return runtime
  }
  private async callMcp(nativeId: string, chatId: string, tool: string, args: Record<string, unknown> = {}, server = 'lilbot_system') {
    const conn = this.requireRuntime(nativeId).connections.find(c => c.name === server)
    if (!conn) return { ok: false, text: `Missing MCP connection: ${server}` }
    return callMcpServer(conn, tool, args, callId => {
      const reported: ToolCallSeen = { engineBotId: nativeId, chatId, tool: this.mcpToolName(server, tool), args, callId }
      for (const listener of this.toolListeners) listener(reported)
    })
  }
}
