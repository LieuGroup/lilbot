/** The choices in a bot's model menu, from the engine's model list. Pure functions only. */
import type { BotModel, ModelProvider } from '../../../shared/bot-schema'

const SEPARATOR = '::'

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

export interface ModelPillView {
  label: string
  saving: boolean
  /** The saved model is no longer offered: the pill reads "Choose a model" in red. */
  missing: boolean
}

/** What the composer's model pill shows. While a change saves it shows the new model. The saved
 *  model counts as missing only once the engine's list has loaded (`providers` not null) and lacks it. */
export function modelPillView(model: BotModel | null, providers: ModelProvider[] | null, saving: BotModel | null): ModelPillView {
  if (saving) return { label: saving.model, saving: true, missing: false }
  if (!model) return { label: 'Default model', saving: false, missing: false }
  const offered = !providers || providers.some(provider => provider.provider === model.provider && provider.models.includes(model.model))
  return offered ? { label: model.model, saving: false, missing: false } : { label: 'Choose a model', saving: false, missing: true }
}
