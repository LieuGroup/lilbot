/** The Bot: LilBot's own definition, independent of the engine that runs it. Three owners:
 *  LilBot holds identity, instructions and model; LilBot holds skills; the engine holds tools and connectors; the user holds sidebar
 *  preferences (LilBot's database); the bot holds its workspace folder. */
import { z } from 'zod'

import { BotActivity } from './activity-schema'
import { Avatar } from './avatar'

export const PermissionMode = z.enum(['approval-required', 'auto-accept-edits', 'auto', 'full-access'])
export type PermissionMode = z.infer<typeof PermissionMode>

export const BotModel = z.object({ provider: z.string(), model: z.string() })
export type BotModel = z.infer<typeof BotModel>

/** How hard a bot's model thinks. `none` turns thinking off. A bot with no effort follows the engine's default.
 *  `ultra` is left out: no provider accepts it. */
export const ReasoningEffort = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
export type ReasoningEffort = z.infer<typeof ReasoningEffort>

/** A bot’s durable identity. */
export const BotIdentity = z.object({
  id: z.string(),
  name: z.string(),
  /** What the bot is for, in a sentence or two. */
  function: z.string(),
  model: BotModel.nullable(),
  /** The user's choice, kept as chosen when the model changes. Null: the engine's default. */
  reasoningEffort: ReasoningEffort.nullable().default(null),
  permissionMode: PermissionMode.default('full-access'),
  /** The engine's built-in main bot; it cannot be deleted. */
  isDefault: z.boolean()
})
export type BotIdentity = z.infer<typeof BotIdentity>

/** The user's own settings for a bot. They never change the bot itself. */
export const BotPrefs = z.object({
  avatar: Avatar,
  /** The sidebar section the bot sits in, or null for none. */
  sectionId: z.string().nullable(),
  pinned: z.boolean(),
  /** When the bot was pinned (ms since epoch), so pinned bots keep that order; null when not pinned. */
  pinnedAt: z.number().nullable(),
  hidden: z.boolean()
})
export type BotPrefs = z.infer<typeof BotPrefs>

/** A running temporary group the bot is in, for the roster's "Working together" section and its row state. */
export const BotGroup = z.object({
  id: z.string(),
  purpose: z.string(),
  round: z.number(),
  roundCap: z.number(),
  leading: z.boolean(),
  /** What the bot is doing in this group right now, while its turn there runs and a tool call has been seen. */
  activity: z.string().optional()
})
export type BotGroup = z.infer<typeof BotGroup>
/** The exchange a bot is working on now for another bot, and that bot's name. */
export const BotWorkingFor = z.object({ threadId: z.string(), name: z.string() })
export type BotWorkingFor = z.infer<typeof BotWorkingFor>

/** Current context size of the bot's main conversation against the model's window. */
export const BotContext = z.object({
  /** Tokens currently in the main conversation's context. */
  used: z.number().int().nonnegative(),
  /** Model context window in tokens, or null when the engine does not report it. */
  window: z.number().int().positive().nullable()
})
export type BotContext = z.infer<typeof BotContext>

/** What lists and headers need. */
export const Bot = BotIdentity.extend({
  /** The user's primary bot, resolved by LilBot rather than the engine. */
  isPrimary: z.boolean(),
  /** False when the saved bot has no available engine runtime. */
  runnable: z.boolean().default(true),
  /** Runtime preparation has not finished; runnable is not yet known. */
  runtimePending: z.boolean().optional(),
  activity: BotActivity.optional(),
  /** Running groups it leads or is in; absent when none. */
  groups: z.array(BotGroup).optional(),
  /** Set while it works on a task another bot handed it. */
  workingFor: BotWorkingFor.optional(),
  prefs: BotPrefs,
  /** The bot's own folder on the shared computer; its chats work there. */
  workspace: z.string(),
  /** The level the engine really sends for the main conversation, which may differ from `reasoningEffort`
   *  (the engine adapts a level the model does not take). Null: none is sent. Absent until the engine has reported it. */
  effectiveReasoningEffort: z.string().nullable().optional(),
  /** Current context size of the bot's main conversation against its model's window. Absent until reported. */
  context: BotContext.optional()
})
export type Bot = z.infer<typeof Bot>

/** One thing a bot can use, in engine-neutral terms. */
export const Ability = z.object({ kind: z.enum(['skill', 'toolset', 'connector']), id: z.string(), label: z.string(), enabled: z.boolean() })
export type Ability = z.infer<typeof Ability>

/** Settings and runtime abilities for the bot's own page. */
export const BotSetup = z.object({
  /** Personality and standing instructions the bot follows in every chat. */
  instructions: z.string(),
  abilities: z.array(Ability),
  /** The bot reads and writes LilBot's memory (not the engine's own). */
  memoryConnected: z.boolean()
})
export type BotSetup = z.infer<typeof BotSetup>

export const BotDetail = Bot.extend(BotSetup.shape)
export type BotDetail = z.infer<typeof BotDetail>

const name = z.string().trim().min(1, 'Give the bot a name.').max(60)
const botFunction = z.string().trim().max(500)
const instructions = z.string().max(20_000)

export const BotCreateInput = z.object({
  name,
  function: botFunction.default(''),
  instructions: instructions.default(''),
  model: BotModel.optional(),
  permissionMode: PermissionMode.optional(),
  avatar: Avatar.optional()
})
export type BotCreateInput = z.infer<typeof BotCreateInput>

export const BotUpdateInput = z.object({
  botId: z.string().min(1),
  name: name.optional(),
  function: botFunction.optional(),
  instructions: instructions.optional(),
  model: BotModel.optional(),
  /** Null goes back to the engine's default. */
  reasoningEffort: ReasoningEffort.nullable().optional(),
  permissionMode: PermissionMode.optional()
})
export type BotUpdateInput = z.infer<typeof BotUpdateInput>

export const BotPrefsInput = z.object({
  botId: z.string().min(1),
  avatar: Avatar.optional(),
  sectionId: z.string().min(1).nullable().optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional()
})
export type BotPrefsInput = z.infer<typeof BotPrefsInput>

export const Section = z.object({ id: z.string(), name: z.string() })
export type Section = z.infer<typeof Section>

export const sectionName = z.string().trim().min(1, 'Give the section a name.').max(40)

/** What the engine says one model can do. `canDisableReasoning` is null when the engine does not say: hide "Off" only when false. */
export const ModelCapability = z.object({ id: z.string(), reasoning: z.boolean(), canDisableReasoning: z.boolean().nullable() })
export type ModelCapability = z.infer<typeof ModelCapability>

export const ModelProvider = z.object({ provider: z.string(), name: z.string(), models: z.array(z.string()), capabilities: z.array(ModelCapability) })
export type ModelProvider = z.infer<typeof ModelProvider>
