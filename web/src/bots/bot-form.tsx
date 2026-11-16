/** The bot's editable fields, shared by "New bot" and the bot's settings page. */
import { type FormEvent, useEffect, useState } from 'react'

import type { BotModel, ModelProvider } from '../../../shared/bot-schema'
import { lebot } from '../lebot-socket'
import { Button, Field, Notice, Select, TextArea, TextInput } from '../ui/controls'

export interface BotFormValues {
  name: string
  function: string
  instructions: string
  model: BotModel | null
}

interface BotFormProps {
  initial: BotFormValues
  submitLabel: string
  /** Shown as the first model choice when no model is picked, e.g. "Same as the main bot". */
  noModelLabel?: string
  onSubmit: (values: BotFormValues) => Promise<void>
}

const SEPARATOR = '::'
const modelValue = (model: BotModel | null) => (model ? `${model.provider}${SEPARATOR}${model.model}` : '')

export function BotForm({ initial, submitLabel, noModelLabel, onSubmit }: BotFormProps) {
  const [values, setValues] = useState(initial)
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    lebot
      .call('models.list', {})
      .then(setProviders)
      .catch(() => setProviders([]))
  }, [])

  const set = (patch: Partial<BotFormValues>) => {
    setValues(current => ({ ...current, ...patch }))
    setSaved(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSubmit({ ...values, name: values.name.trim(), function: values.function.trim() })
      setSaved(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const current = modelValue(values.model)
  const known = providers.some(provider => provider.models.some(model => `${provider.provider}${SEPARATOR}${model}` === current))

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field label="Name">
        <TextInput value={values.name} maxLength={60} required placeholder="Researcher" onChange={event => set({ name: event.target.value })} />
      </Field>
      <Field label="Function" hint="What this bot is for, in a sentence or two.">
        <TextArea
          rows={2}
          value={values.function}
          maxLength={500}
          placeholder="Finds and compares sources, then reports with links."
          onChange={event => set({ function: event.target.value })}
        />
      </Field>
      <Field label="Instructions" hint="Personality and standing rules the bot follows in every chat.">
        <TextArea rows={10} value={values.instructions} className="font-mono text-sm" onChange={event => set({ instructions: event.target.value })} />
      </Field>
      <Field label="Model">
        <Select
          value={current}
          onChange={event => {
            const [provider, ...rest] = event.target.value.split(SEPARATOR)
            set({ model: event.target.value ? { provider, model: rest.join(SEPARATOR) } : null })
          }}
        >
          {noModelLabel && <option value="">{noModelLabel}</option>}
          {current && !known && <option value={current}>{values.model?.model}</option>}
          {providers.map(provider => (
            <optgroup key={provider.provider} label={provider.name}>
              {provider.models.map(model => (
                <option key={model} value={`${provider.provider}${SEPARATOR}${model}`}>
                  {model}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="ok">Saved.</Notice>}
      <div>
        <Button type="submit" disabled={saving || !values.name.trim()}>
          {saving ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
