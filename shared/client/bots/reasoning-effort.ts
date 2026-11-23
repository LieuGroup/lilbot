/** A bot's reasoning effort on screen (composer pill and menu, Setup), from the bot and the engine's model list. Pure functions only. */
import type { BotModel, ModelCapability, ModelProvider, ReasoningEffort } from '../../../shared/bot-schema'

const LABELS: Record<string, string> = { none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

/** A level's name; null (the engine's default) reads "Default". A level LilBot does not know shows as the engine names it. */
export const effortLabel = (level: string | null) => (level === null ? 'Default' : (LABELS[level] ?? level))

/** What the engine says the model can do; undefined for no model or one it does not list. */
export function capabilityOf(providers: ModelProvider[] | null, model: BotModel | null): ModelCapability | undefined {
  if (!model) return undefined
  return providers?.find(provider => provider.provider === model.provider)?.capabilities.find(capability => capability.id === model.model)
}

/** Only a model the engine says does not reason has no effort, as on the server: an unknown model is sent the level. */
export const reasons = (capability: ModelCapability | undefined) => capability?.reasoning !== false

/** The level sent differs from the one chosen. Unknown until the engine reports it; Default lets the engine choose; the engine
 *  reports both Off and no level as none (null), so that pair never differs. */
export const sentDiffers = (chosen: ReasoningEffort | null, sent: string | null | undefined) => sent !== undefined && chosen !== null && (sent ?? 'none') !== chosen

/** The menu row's value: "High", or "Max, sent as High". */
export function effortValue(chosen: ReasoningEffort | null, sent: string | null | undefined) {
  return sentDiffers(chosen, sent) ? `${effortLabel(chosen)}, sent as ${effortLabel(sent ?? 'none')}` : effortLabel(chosen)
}
