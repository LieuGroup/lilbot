/** Primary-bot creation, with durable retry identity and a hidden first turn. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { BotCreateInput } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/protocol'
import { memoryRefusal } from '../memory/memory-safety'
import type { BotService } from './bot-service'
import type { BotRecord, BotStore } from './bot-store'

export const BotCreationInput = BotCreateInput.pick({ name: true, function: true, instructions: true }).extend({ requestId: z.string().min(1).max(200) })
export type BotCreationInput = z.infer<typeof BotCreationInput>
const GREETING =
  'Introduce yourself to Oscar in a short greeting and suggest three concrete tasks you could help him start, based on your instructions. Do not use tools or claim to have done work. This is your first message in your main conversation.'

export class BotCreation {
  private pending = new Map<string, Promise<{ id: string; url: string }>>()
  constructor(
    private service: BotService,
    private store: BotStore
  ) {}

  create(caller: BotRecord, raw: BotCreationInput) {
    const input = BotCreationInput.parse(raw)
    const refusal = memoryRefusal(`${input.name}\n${input.function}\n${input.instructions}`)
    if (refusal) throw new LilBotError('invalid_instructions', refusal)
    const hash = createHash('sha256')
      .update(JSON.stringify([caller.id, input.requestId]))
      .digest('hex')
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
    const existing = this.pending.get(id)
    if (existing) return existing
    const work = this.run(caller, input, id).finally(() => this.pending.delete(id))
    this.pending.set(id, work)
    return work
  }

  private async run(caller: BotRecord, input: BotCreationInput, id: string) {
    if (!this.store.creationDone(id)) {
      await this.service.createBot({ ...input, ...(caller.model ? { model: caller.model } : {}) }, id)
      const chat = await this.service.openChat(id, undefined, () => {})
      // Submission IDs make an interrupted HTTP retry safe, including after a server restart.
      try {
        await chat.send(GREETING, { hidden: true, inputId: `greeting-${id}` })
      } finally {
        chat.close()
      }
      this.store.finishCreation(id)
    }
    return { id, url: `/bots/${id}` }
  }
}
