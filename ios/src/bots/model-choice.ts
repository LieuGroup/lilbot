/** The model and reasoning-effort choices for one bot, from the engine's model list. Pure functions only;
 *  the iOS port of web/src/bots/model-choice.ts + reasoning-effort.ts. */
import type { Bot, BotModel, ModelCapability, ModelProvider, ReasoningEffort } from '../../../shared/bot-schema'

const SEPARATOR = '::'
const LABELS: Record<string, string> = { none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

/** A change the composer's menu saves: the model, the effort or both. */
export interface PickerChange {
  model?: BotModel
  reasoningEffort?: ReasoningEffort | null
}

interface ModelOption {
  key: string
  label: string
}

export interface ModelGroup {
  label?: string
  options: ModelOption[]
}

/** One string per model, so a menu row can be compared and keyed. No model is the empty string. */
export const modelKey = (model: BotModel | null) => (model ? `${model.provider}${SEPARATOR}${model.model}` : '')

export function modelFromKey(key: string): BotModel | null {
  if (!key) return null
  const [provider, ...rest] = key.split(SEPARATOR)
  return { provider, model: rest.join(SEPARATOR) }
}

/** The menu's groups: the current model first when the engine no longer lists it, then one group per provider. */
export function modelGroups(providers: ModelProvider[], current: BotModel | null): ModelGroup[] {
  const listed = providers.map(provider => ({
    label: provider.name,
    options: provider.models.map(model => ({ key: modelKey({ provider: provider.provider, model }), label: model }))
  }))
  const currentKey = modelKey(current)
  const known = listed.some(group => group.options.some(option => option.key === currentKey))
  const top: ModelOption[] = current && !known ? [{ key: currentKey, label: current.model }] : []
  return top.length > 0 ? [{ options: top }, ...listed] : listed
}

/** What the menu's button shows for the chosen model. */
export function modelLabel(groups: ModelGroup[], current: BotModel | null): string {
  const key = modelKey(current)
  return groups.flatMap(group => group.options).find(option => option.key === key)?.label ?? current?.model ?? 'Choose a model'
}

/** A level's name; null (the engine's default) reads "Default". */
export const effortLabel = (level: string | null) => (level === null ? 'Default' : (LABELS[level] ?? level))

/** What the engine says the model can do; undefined for no model or one it does not list. */
export function capabilityOf(providers: ModelProvider[] | null, model: BotModel | null): ModelCapability | undefined {
  if (!model) return undefined
  return providers?.find(provider => provider.provider === model.provider)?.capabilities.find(capability => capability.id === model.model)
}

/** Only a model the engine says does not reason has no effort; an unknown model is sent the level. */
export const reasons = (capability: ModelCapability | undefined) => capability?.reasoning !== false

/** The level sent differs from the one chosen. Unknown until the engine reports it. */
export const sentDiffers = (chosen: ReasoningEffort | null, sent: string | null | undefined) => sent !== undefined && chosen !== null && (sent ?? 'none') !== chosen

/** The menu row's value: "High", or "Max, sent as High". */
export function effortValue(chosen: ReasoningEffort | null, sent: string | null | undefined) {
  return sentDiffers(chosen, sent) ? `${effortLabel(chosen)}, sent as ${effortLabel(sent ?? 'none')}` : effortLabel(chosen)
}

export interface ModelPillView {
  label: string
  effort: string | null
  differs: boolean
  saving: boolean
  missing: boolean
}

type PillBot = Pick<Bot, 'model' | 'reasoningEffort' | 'effectiveReasoningEffort'>

/** What the composer's model pill shows. While a change saves it shows the new values. */
export function modelPillView(bot: PillBot, providers: ModelProvider[] | null, saving: PickerChange | null): ModelPillView {
  const model = saving?.model ?? bot.model
  const chosen = saving?.reasoningEffort !== undefined ? saving.reasoningEffort : bot.reasoningEffort
  const offered = !model || !providers || providers.some(provider => provider.provider === model.provider && provider.models.includes(model.model))
  if (!saving && !offered) return { label: 'Choose a model', effort: null, differs: false, saving: false, missing: true }
  const thinks = reasons(capabilityOf(providers, model))
  return {
    label: model?.model ?? 'Default model',
    effort: thinks ? effortLabel(chosen) : null,
    differs: !saving && thinks && sentDiffers(chosen, bot.effectiveReasoningEffort),
    saving: !!saving,
    missing: false
  }
}
