/** The Bot: LeBot's own definition, independent of the engine that runs it. */
import { z } from 'zod'

export const BotModel = z.object({ provider: z.string(), model: z.string() })
export type BotModel = z.infer<typeof BotModel>

/** What lists and headers need. */
export const Bot = z.object({
  id: z.string(),
  name: z.string(),
  /** What the bot is for, in a sentence or two. */
  function: z.string(),
  model: BotModel.nullable(),
  /** The engine's built-in main bot; it cannot be deleted. */
  isDefault: z.boolean(),
  skillCount: z.number()
})
export type Bot = z.infer<typeof Bot>

export const Ability = z.object({ name: z.string(), label: z.string(), enabled: z.boolean() })

/** Everything the bot page shows. */
export const BotDetail = Bot.extend({
  /** Personality and standing instructions the bot follows in every chat. */
  instructions: z.string(),
  toolsets: z.array(Ability),
  enabledSkillCount: z.number(),
  mcpServerCount: z.number()
})
export type BotDetail = z.infer<typeof BotDetail>

const name = z.string().trim().min(1, 'Give the bot a name.').max(60)
const botFunction = z.string().trim().max(500)
const instructions = z.string().max(20_000)

export const BotCreateInput = z.object({ name, function: botFunction.default(''), instructions: instructions.default(''), model: BotModel.optional() })
export type BotCreateInput = z.infer<typeof BotCreateInput>

export const BotUpdateInput = z.object({
  botId: z.string().min(1),
  name: name.optional(),
  function: botFunction.optional(),
  instructions: instructions.optional(),
  model: BotModel.optional()
})
export type BotUpdateInput = z.infer<typeof BotUpdateInput>

export const ModelProvider = z.object({ provider: z.string(), name: z.string(), models: z.array(z.string()) })
export type ModelProvider = z.infer<typeof ModelProvider>
