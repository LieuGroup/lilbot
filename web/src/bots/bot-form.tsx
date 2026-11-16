/** The bot's editable fields, shared by "New bot" and the bot's settings page. */
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react'
import { Button } from '@/ui/button'
import { FormField } from '@/ui/form-field'
import { Input } from '@/ui/input'
import { Notice } from '@/ui/notice'
import { Textarea } from '@/ui/textarea'
import type { BotModel, ModelProvider } from '../../../shared/bot-schema'
import { lilbot } from '../app/lilbot-socket'
import { ModelSelector } from './model-selector'

export interface BotFormValues {
  name: string
  function: string
  instructions: string
  model: BotModel | null
}

interface BotFormProps {
  children?: ReactNode
  initial: BotFormValues
  submitLabel: string
  /** Shown as the first model choice when no model is picked, e.g. "Same as the main bot". */
  noModelLabel?: string
  onSubmit: (values: BotFormValues) => Promise<void>
}

export function BotForm({ initial, submitLabel, noModelLabel, onSubmit, children }: BotFormProps) {
  const [values, setValues] = useState(initial)
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const id = useId()

  useEffect(() => {
    lilbot
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <FormField label="Name" htmlFor={`${id}-name`}>
        <Input id={`${id}-name`} value={values.name} maxLength={60} required placeholder="Researcher" className="h-10" onChange={event => set({ name: event.target.value })} />
      </FormField>
      {children}
      <FormField label="Function" hint="What this bot is for, in a sentence or two." htmlFor={`${id}-function`}>
        <Textarea
          id={`${id}-function`}
          value={values.function}
          maxLength={500}
          placeholder="Finds and compares sources, then reports with links."
          onChange={event => set({ function: event.target.value })}
        />
      </FormField>
      <FormField label="Instructions" hint="Personality and standing rules the bot follows in every chat." htmlFor={`${id}-instructions`}>
        <Textarea
          id={`${id}-instructions`}
          value={values.instructions}
          className="max-h-[28rem] min-h-48 font-mono"
          onChange={event => set({ instructions: event.target.value })}
        />
      </FormField>
      <FormField label="Model" htmlFor={`${id}-model`}>
        <ModelSelector id={`${id}-model`} providers={providers} value={values.model} noModelLabel={noModelLabel} onChange={model => set({ model })} />
      </FormField>

      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="ok">Saved.</Notice>}
      <div>
        <Button type="submit" size="lg" disabled={saving || !values.name.trim()}>
          {saving ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
