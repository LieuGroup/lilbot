/** The bot's editable fields, shared by "New bot" and the bot's settings page. */
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { Button } from '@/ui/button'
import { FormField } from '@/ui/form-field'
import { Input } from '@/ui/input'
import { Notice } from '@/ui/notice'
import { Textarea } from '@/ui/textarea'
import type { BotModel, ReasoningEffort } from '../../../shared/bot-schema'
import { capabilityOf, effortLabel, reasons, sentDiffers } from '../../../shared/client/bots/reasoning-effort'
import { EffortSelector } from './effort-choices'
import { useModelProviders } from './model-list'
import { ModelSelector } from './model-selector'

interface BotFormValues {
  name: string
  function: string
  instructions: string
  model: BotModel | null
  /** Only for a saved bot (Setup); a new bot starts on the engine's default. */
  reasoningEffort?: ReasoningEffort | null
}

interface BotFormProps {
  children?: ReactNode
  initial: BotFormValues
  submitLabel: string
  /** Shown as the first model choice when no model is picked, e.g. "Same as the main bot". */
  noModelLabel?: string
  /** The level the engine reports it sends for the saved effort (Setup). */
  sentEffort?: string | null
  /** Optional context occupancy card shown under the model fields (Setup). */
  context?: ReactNode
  /** Muted note shown below Instructions when saved text still mentions leftover engine identity. */
  instructionsNote?: string
  onSubmit: (values: BotFormValues) => Promise<void>
}

export function BotForm({ initial, submitLabel, noModelLabel, sentEffort, context, instructionsNote, onSubmit, children }: BotFormProps) {
  const [values, setValues] = useState(initial)
  const listed = useModelProviders()
  const providers = listed ?? []
  const capability = capabilityOf(listed, values.model)
  const effort = values.reasoningEffort
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const id = useId()

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
        {instructionsNote && values.instructions === initial.instructions && <p className="mt-1.5 text-xs text-muted-foreground">{instructionsNote}</p>}
      </FormField>
      <FormField label="Model" htmlFor={`${id}-model`}>
        <ModelSelector id={`${id}-model`} providers={providers} value={values.model} noModelLabel={noModelLabel} onChange={model => set({ model })} />
      </FormField>
      {effort !== undefined && reasons(capability) && (
        <FormField
          label="Reasoning effort"
          hint={effort === initial.reasoningEffort && sentDiffers(effort, sentEffort) ? `Sent as ${effortLabel(sentEffort ?? 'none')}.` : undefined}
          htmlFor={`${id}-effort`}
        >
          <EffortSelector id={`${id}-effort`} value={effort} canDisable={capability?.canDisableReasoning} onChange={level => set({ reasoningEffort: level })} />
        </FormField>
      )}
      {context}

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
