/** Primary-bot creation, with durable retry identity and a hidden first turn. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { BotCreateInput } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { backgroundFailure } from '../background'
import { memoryRefusal } from '../memory/memory-safety'
import type { BotService } from './bot-service'
import type { BotRecord, BotStore } from './bot-store'

export const BotCreationInput = BotCreateInput.pick({ name: true, function: true, instructions: true }).extend({ requestId: z.string().min(1).max(200) })
export type BotCreationInput = z.infer<typeof BotCreationInput>
export interface BotCreationOptions {
  /** When false (session-bound limited MCP calls), returns immediately after creating the bot and runs the hidden
   *  greeting turn in the background so creation always completes well under Hermes's 30 s editor MCP timeout. */
  waitForGreeting?: boolean
}
const GREETING =
  'Introduce yourself to the owner in a short greeting and suggest three concrete tasks you could help the owner start, based on your instructions. Do not use tools or claim to have done work. This is your first message in your main conversation.'

export class BotCreation {
  private creating = new Map<string, Promise<void>>()
  private pending = new Map<string, Promise<{ id: string; url: string; greetingPending?: true }>>()
  private greetings = new Map<string, Promise<void>>()
  constructor(
    private service: BotService,
    private store: BotStore
  ) {}

  create(caller: BotRecord, raw: BotCreationInput, options: BotCreationOptions = {}) {
    const input = BotCreationInput.parse(raw)
    const refusal = memoryRefusal(`${input.name}\n${input.function}\n${input.instructions}`)
    if (refusal) throw new LilBotError('invalid_instructions', refusal)
    const hash = createHash('sha256')
      .update(JSON.stringify([caller.id, input.requestId]))
      .digest('hex')
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
    const wait = options.waitForGreeting !== false
    if (wait) {
      const existing = this.pending.get(id)
      if (existing) return existing
      const work = this.run(caller, input, id, true).finally(() => this.pending.delete(id))
      this.pending.set(id, work)
      return work
    }
    return this.run(caller, input, id, false)
  }

  private ensureCreated(caller: BotRecord, input: BotCreationInput, id: string): Promise<void> {
    if (this.store.exists(id)) return Promise.resolve()
    const existing = this.creating.get(id)
    if (existing) return existing
    const task = this.service
      .createBot({ ...input, ...(caller.model ? { model: caller.model } : {}) }, id, caller.engineId)
      .then(() => undefined)
      .finally(() => this.creating.delete(id))
    this.creating.set(id, task)
    return task
  }

  private startGreeting(id: string): Promise<void> {
    const existing = this.greetings.get(id)
    if (existing) return existing
    const task = (async () => {
      const chat = await this.service.openChat(id, undefined, () => {})
      // Submission IDs make an interrupted HTTP retry safe, including after a server restart.
      try {
        await chat.send(GREETING, { hidden: true, inputId: `greeting-${id}` })
      } finally {
        chat.close()
      }
      this.store.finishCreation(id)
    })().finally(() => this.greetings.delete(id))
    this.greetings.set(id, task)
    return task
  }

  private async run(caller: BotRecord, input: BotCreationInput, id: string, waitForGreeting: boolean) {
    if (!this.store.creationDone(id)) {
      await this.ensureCreated(caller, input, id)
      const greeting = this.startGreeting(id)
      if (!waitForGreeting) {
        void greeting.catch(() => backgroundFailure('bot creation greeting'))
        return { id, url: `/bots/${id}`, greetingPending: true as const }
      }
      await greeting
    }
    return { id, url: `/bots/${id}` }
  }
}
