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

/** A bot’s durable identity. */
export const BotIdentity = z.object({
  id: z.string(),
  name: z.string(),
  /** What the bot is for, in a sentence or two. */
  function: z.string(),
  model: BotModel.nullable(),
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

/** What lists and headers need. */
export const Bot = BotIdentity.extend({
  /** The user's primary bot, resolved by LilBot rather than the engine. */
  isPrimary: z.boolean(),
  /** False when the saved bot has no available engine runtime. */
  runnable: z.boolean().default(true),
  /** Runtime preparation has not finished; runnable is not yet known. */
  runtimePending: z.boolean().optional(),
  activity: BotActivity.optional(),
  prefs: BotPrefs,
  /** The bot's own folder on the shared computer; its chats work there. */
  workspace: z.string()
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

export const ModelProvider = z.object({ provider: z.string(), name: z.string(), models: z.array(z.string()) })
export type ModelProvider = z.infer<typeof ModelProvider>
