/** Hermes runs LilBot bots through profile bindings and native sessions. */
import type { ActivityEvent } from '../../../shared/activity-schema'
import type { BotIdentity, BotModel } from '../../../shared/bot-schema'
import type { ChatEvent } from '../../../shared/chat-schema'
import { LilBotError } from '../../../shared/lilbot-error'
import type { ActivityCursor, BotEngine, ChatOptions, MemoryConnection, ReviewOptions, RuntimeBinding, RuntimeIdentity, SessionChange } from '../bot-engine'
import { watchHermesActivity } from './hermes-activity'
import { adapterHash, applied, hashOf } from './hermes-applied'
import { botDetailFromProfile, botFromProfile, DEFAULT_PROFILE, providersFromModelOptions, requireListedModel } from './hermes-bot-mapping'
import { openChat } from './hermes-chat'
import { configureComputers } from './hermes-computers'
import { connectionPreparer, hermesMcpToolName } from './hermes-connections'
import { deleteRuntime } from './hermes-delete'
import { allowedProfile, requireProfileEnvironment } from './hermes-environment'
import { conversations } from './hermes-history'
import { compressionRoot } from './hermes-history-catalog'
import { reviewMemory } from './hermes-memory-review'
import { installMemory, legacyNotes, memoryInstalled, refreshMemoryAdapters } from './hermes-memory-setup'
import { ensureFullAccess } from './hermes-permissions'
import { runRoutine } from './hermes-routines'
import { steerRun, stopRun } from './hermes-run-control'
import { applyIdentity, createRuntime } from './hermes-runtime'
import { updateSession } from './hermes-session-settings'
import { ALWAYS_ON_SKILLS, bundledSkillNames, configureSkills, skillsFingerprint, userSkillPaths } from './hermes-skills'
import { HermesSocket, managementConnection } from './hermes-socket'
import { SpareSockets } from './hermes-spare-sockets'
import { onToolCall } from './hermes-tool-calls'

const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
export class HermesEngine implements BotEngine {
  conversations = conversations
  compressionRoot = compressionRoot
  readonly id = 'hermes'
  private spares = new SpareSockets()
  readonly supportedPermissionModes = ['full-access'] as const
  constructor(private botIds?: string[]) {}

  watchActivity(
    bots: () => Promise<RuntimeBinding[]>,
    listener: (event: ActivityEvent) => void,
    cursor: ActivityCursor,
    availability?: (nativeId: string, available: boolean) => void,
    conversationEvent?: (botId: string, chatId: string, event: ChatEvent, key: string) => void
  ) {
    const known = new Map<string, boolean>()
    return watchHermesActivity(
      async () => {
        const bound = await bots()
        const profiles = new Set((await this.profiles()).map(bot => bot.id))
        for (const bot of bound) {
          const present = profiles.has(bot.engineBotId)
          if ((!present || known.has(bot.engineBotId)) && known.get(bot.engineBotId) !== present) availability?.(bot.engineBotId, present)
          known.set(bot.engineBotId, present)
        }
        return bound.filter(bot => profiles.has(bot.engineBotId))
      },
      listener,
      cursor,
      conversationEvent
    )
  }
  private management = managementConnection()
  onBotsChanged = this.management.subscribe

  async importBots() {
    const bots = await this.profiles()
    return Promise.all(bots.map(bot => this.getBot(bot.id)))
  }

  private async getBot(botId: string) {
    const summary = await this.requireBot(botId)
    const described = await (await this.management.socket()).request('profiles.describe', { name: botId })
    return { ...botDetailFromProfile(summary, described), memoryConnected: memoryInstalled(botId) }
  }

  async connectMemory(botId: string, connection: MemoryConnection) {
    await this.requireBot(botId)
    const notes = await legacyNotes(botId)
    await applied(botId, null, '', () => installMemory(botId, connection))
    return notes
  }

  async createRuntime(identity: RuntimeIdentity): Promise<string> {
    const id = await createRuntime(await this.management.socket(), identity)
    this.botIds?.push(id)
    await this.prepareRuntime(id)
    return id
  }

  async applyIdentity(id: string, identity: RuntimeIdentity) {
    const detail = await this.getBot(id)
    await applied(id, null, '', async () => applyIdentity(await this.management.socket(), id, identity, detail))
    return { abilities: detail.abilities, memoryConnected: memoryInstalled(id, identity.id) }
  }

  async deleteRuntime(id: string) {
    requireProfileEnvironment(id)
    if (!PROFILE_ID.test(id) || id === DEFAULT_PROFILE) throw new LilBotError('protected_bot', 'The default bot cannot be deleted.')
    if (this.botIds && !this.botIds.includes(id)) throw new LilBotError('bot_not_found', 'That bot does not exist.')
    this.spares.drop(id)
    await deleteRuntime(id)
  }

  async prepareRuntime(id: string) {
    requireProfileEnvironment(id)
    const socket = await HermesSocket.connect(id === DEFAULT_PROFILE ? '' : id)
    try {
      await ensureFullAccess(socket)
    } finally {
      socket.close()
    }
  }

  refreshMemory(botIds: string[]): Promise<string[]> {
    return refreshMemoryAdapters(botIds.filter(id => allowedProfile(id) && (!this.botIds || this.botIds.includes(id))))
  }

  onToolCall = onToolCall
  async stopRun(id: string, chatId: string) {
    await this.requireBot(id)
    return stopRun(id, chatId)
  }
  async steerRun(id: string, chatId: string, text: string) {
    await this.requireBot(id)
    return steerRun(id, chatId, text)
  }

  async reviewMemory(botId: string, prompt: string, options: ReviewOptions): Promise<void> {
    await this.requireBot(botId)
    return reviewMemory(botId, prompt, options)
  }
  async runRoutine(botId: string, prompt: string, options: import('../bot-engine').RoutineOptions & ChatOptions) {
    await this.requireBot(botId)
    return runRoutine(botId, prompt, options)
  }

  private connections = connectionPreparer(id => HermesSocket.connect(id === DEFAULT_PROFILE ? '' : id))
  mcpToolName = hermesMcpToolName
  async prepareConnections(id: string, connections: import('../mcp-connection').McpConnection[]): Promise<boolean> {
    await this.requireBot(id)
    const changed = await applied(id, 'connections', hashOf('v2', connections), () => this.connections.prepare(id, connections))
    if (!changed) await applied(id, null, '', () => this.connections.prepare(id, connections, true))
    return changed
  }
  async applyConnections(id: string, chatIds: string[]) {
    await this.requireBot(id)
    return this.connections.apply(id, chatIds)
  }
  private computerSettings = new Map<string, string>()
  async configureComputers(id: string, settings: { url: string; tokenFile: string; botId: string }) {
    await this.requireBot(id)
    const key = JSON.stringify(settings)
    if (this.computerSettings.get(id) === key) return
    await applied(id, 'computers', hashOf(adapterHash('computers-adapter'), settings), () => configureComputers(id, settings))
    this.computerSettings.set(id, key)
  }

  private skillSettings = new Map<string, string>()
  readonly alwaysOnSkills = ALWAYS_ON_SKILLS
  userSkillPaths = userSkillPaths
  bundledSkills = bundledSkillNames
  async configureSkills(id: string, settings: Parameters<typeof configureSkills>[1]) {
    await this.requireBot(id)
    const key = JSON.stringify(settings)
    if (this.skillSettings.get(id) === key) return
    const activate = !this.skillSettings.has(id)
    await applied(id, 'skills', hashOf(adapterHash('skills-adapter'), ...skillsFingerprint(id, settings)), () => configureSkills(id, settings, activate))
    this.skillSettings.set(id, key)
  }
  validateModel = async (model: BotModel) => requireListedModel(await this.listModels(), model)

  async listModels() {
    return providersFromModelOptions(await (await this.management.socket()).request('model.options'))
  }
  async updateSession(botId: string, chatId: string, change: SessionChange) {
    await this.requireBot(botId)
    return updateSession(botId, chatId, change)
  }

  async openChat(botId: string, chatId: string | null, options: ChatOptions, onEvent: (event: ChatEvent) => void) {
    await this.requireBot(botId)
    return openChat(this.spares, botId, chatId, options, onEvent)
  }

  private async profiles(): Promise<BotIdentity[]> {
    const result = await (await this.management.socket()).request('profiles.list', { include_sessions: false })
    const profiles: any[] = Array.isArray(result.profiles) ? result.profiles : []
    return profiles
      .map(botFromProfile)
      .filter(bot => allowedProfile(bot.id) && (!this.botIds || this.botIds.includes(bot.id)))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
  }

  /** Every native profile id passes here before it reaches Hermes or a subprocess. */
  private async requireBot(engineBotId: string): Promise<BotIdentity> {
    const bot = PROFILE_ID.test(engineBotId) ? (await this.profiles()).find(candidate => candidate.id === engineBotId) : undefined
    if (!bot) throw new LilBotError('bot_not_found', 'That bot does not exist.')
    return bot
  }
}
