/** Disposable compatibility shim: ACP has sessions, not profiles. No product migration here. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import type { BotCreateInput, BotUpdateInput, ModelProvider } from '../../../shared/bot-schema'
import type { ChatEvent } from '../../../shared/chat-schema'
import { LilBotError } from '../../../shared/protocol'
import type { BotEngine, ChatOptions, EngineBotDetail, MemoryConnection, ReviewOptions } from '../bot-engine'
import { openAcpChat } from './acp-chat'
import { MEMORY_RULES } from './acp-memory'
import { subscriptionHome } from './acp-process'

type Record = { detail: EngineBotDetail; memory?: MemoryConnection; sessions: { [id: string]: string } }

export class AcpEngine implements BotEngine {
  private records: Record[]
  private home: string
  private models: string[] = []
  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.home = subscriptionHome(join(directory, 'codex'))
    this.records = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : []
  }
  private get file() {
    return join(this.directory, 'bots.json')
  }
  private save() {
    writeFileSync(this.file, JSON.stringify(this.records), { mode: 0o600 })
  }
  private record(id: string) {
    const record = this.records.find(r => r.detail.id === id)
    if (!record) throw new LilBotError('bot_not_found', 'That temporary ACP bot does not exist.')
    return record
  }
  async listBots() {
    return this.records.map(r => r.detail)
  }
  async getBot(id: string) {
    return this.record(id).detail
  }
  async createBot(input: BotCreateInput) {
    if (input.model && input.model.provider !== 'codex-acp') throw new LilBotError('invalid_model', 'This spike only supports Codex ACP.')
    const detail: EngineBotDetail = {
      id: `acp-${crypto.randomUUID()}`,
      name: input.name,
      function: input.function,
      instructions: input.instructions,
      model: input.model ?? { provider: 'codex-acp', model: 'gpt-6.1-sol' },
      isDefault: false,
      abilities: [],
      memoryConnected: false
    }
    this.records.push({ detail, sessions: {} })
    this.save()
    return detail
  }
  async updateBot({ botId, ...patch }: BotUpdateInput) {
    if (patch.model && patch.model.provider !== 'codex-acp') throw new LilBotError('invalid_model', 'This spike only supports Codex ACP.')
    Object.assign(this.record(botId).detail, patch)
    this.save()
    return this.getBot(botId)
  }
  async connectMemory(id: string, connection: MemoryConnection) {
    const record = this.record(id)
    record.memory = connection
    record.detail.memoryConnected = true
    this.save()
    return { aboutUser: [], ownNotes: [] }
  }
  async refreshMemory() {
    return []
  }
  async reviewMemory(_id: string, _prompt: string, _options: ReviewOptions): Promise<void> {
    throw new LilBotError('unsupported', 'ACP memory-only review is not implemented; run this spike with review off.')
  }
  onBotsChanged(_listener: () => void) {
    return () => {}
  }
  private captureModels(options: SessionConfigOption[]) {
    const option = options.find(o => o.category === 'model')
    if (option?.type === 'select') this.models = option.options.flatMap(o => ('value' in o ? [o.value] : o.options.map(v => v.value)))
  }
  async listModels(): Promise<ModelProvider[]> {
    // A zero-token discovery session is needed: ACP exposes models per session, not globally.
    if (!this.models.length) {
      const probe = await openAcpChat(
        {
          home: this.home,
          botId: 'discovery',
          chatId: null,
          workspace: this.directory,
          instructions: '',
          model: 'gpt-6.1-sol',
          bindingPath: '',
          onModels: options => this.captureModels(options),
          onSession: () => {}
        },
        () => {}
      )
      probe.close()
    }
    return [{ provider: 'codex-acp', name: 'Codex (ChatGPT subscription)', models: this.models }]
  }
  async openChat(id: string, chatId: string | null, options: ChatOptions, onEvent: (event: ChatEvent) => void) {
    const record = this.record(id)
    if (chatId && !record.sessions[chatId]) throw new LilBotError('chat_not_found', 'No such ACP conversation for this bot.')
    return openAcpChat(
      {
        home: this.home,
        botId: id,
        chatId,
        workspace: chatId ? record.sessions[chatId] : options.workspace,
        instructions: `${record.detail.instructions}\n\n${MEMORY_RULES}`,
        model: record.detail.model!.model,
        binding: record.memory ? { ...record.memory, botId: id } : undefined,
        bindingPath: join(this.directory, `${id}-${crypto.randomUUID()}.json`),
        onModels: values => this.captureModels(values),
        onSession: sessionId => {
          record.sessions[sessionId] = options.workspace
          this.save()
        }
      },
      onEvent
    )
  }
}
