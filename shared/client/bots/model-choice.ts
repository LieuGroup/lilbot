/** The choices in a bot's model menu, from the engine's model list. Pure functions only. */
import type { Bot, BotModel, ModelProvider, ReasoningEffort } from '../../../shared/bot-schema'
import { capabilityOf, effortLabel, reasons, sentDiffers } from './reasoning-effort'

const SEPARATOR = '::'

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
  /** The provider's name; none for the choices above the providers. */
  label?: string
  options: ModelOption[]
}

/** One string per model, so a menu can hold it as its value. No model is the empty string. */
export const modelKey = (model: BotModel | null) => (model ? `${model.provider}${SEPARATOR}${model.model}` : '')

export function modelFromKey(key: string): BotModel | null {
  if (!key) return null
  const [provider, ...rest] = key.split(SEPARATOR)
  return { provider, model: rest.join(SEPARATOR) }
}

/** The menu's groups: "no model" (when allowed), the current model if the engine no longer lists
 *  it, then one group per provider. */
export function modelGroups(providers: ModelProvider[], current: BotModel | null, noModelLabel?: string): ModelGroup[] {
  const listed = providers.map(provider => ({
    label: provider.name,
    options: provider.models.map(model => ({ key: modelKey({ provider: provider.provider, model }), label: model }))
  }))
  const top: ModelOption[] = []
  if (noModelLabel) top.push({ key: '', label: noModelLabel })
  const currentKey = modelKey(current)
  const known = listed.some(group => group.options.some(option => option.key === currentKey))
  if (current && !known) top.push({ key: currentKey, label: current.model })
  return top.length > 0 ? [{ options: top }, ...listed] : listed
}

/** What the menu's button shows for the chosen model. */
export function modelLabel(groups: ModelGroup[], current: BotModel | null): string {
  const key = modelKey(current)
  return groups.flatMap(group => group.options).find(option => option.key === key)?.label ?? current?.model ?? 'Choose a model'
}

interface ModelPillView {
  label: string
  /** The effort's name after the model; null for a model that does not reason. */
  effort: string | null
  /** The engine sends another level than the one chosen: an info mark after the effort. */
  differs: boolean
  saving: boolean
  /** The saved model is no longer offered: the pill reads "Choose a model" in red. */
  missing: boolean
}

type PillBot = Pick<Bot, 'model' | 'reasoningEffort' | 'effectiveReasoningEffort'>

/** What the composer's model pill shows. While a change saves it shows the new values. The saved model counts as missing
 *  only once the engine's list has loaded (`providers` not null) and lacks it. */
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
