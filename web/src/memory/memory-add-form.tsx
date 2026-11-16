import { type FormEvent, useId, useState } from 'react'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Label } from '@/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Textarea } from '@/ui/textarea'
import { defaultScope, type MemoryKind, type MemoryScope } from '../../../shared/memory-schema'

const kinds = [
  { value: 'profile', label: 'Lasting fact' },
  { value: 'journal', label: 'History entry' }
] as const

interface AddFactFormProps {
  busy: boolean
  /** Resolves once the fact is saved; the form then clears. */
  onAdd: (fact: { kind: MemoryKind; scope: MemoryScope; text: string }) => Promise<boolean>
}

/** Add a fact by hand. The kind picks the usual sharing, which the checkbox can override. */
export function AddFactForm({ busy, onAdd }: AddFactFormProps) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<MemoryKind>('profile')
  const [shared, setShared] = useState(true)
  const id = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await onAdd({ kind, scope: shared ? 'shared' : 'bot', text })) setText('')
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h3 className="font-semibold">Add a fact</h3>
      <Textarea value={text} maxLength={500} aria-label="Fact to remember" placeholder="Release notes always as a table." onChange={event => setText(event.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <Select
          items={kinds}
          value={kind}
          onValueChange={value => {
            if (!value) return
            setKind(value)
            setShared(defaultScope(value) === 'shared')
          }}
        >
          <SelectTrigger aria-label="Kind" className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Checkbox id={`${id}-shared`} checked={shared} onCheckedChange={checked => setShared(checked)} />
          <Label htmlFor={`${id}-shared`} className="font-normal">
            Share with all bots
          </Label>
        </div>
        <Button type="submit" size="lg" disabled={busy || !text.trim()}>
          Add
        </Button>
      </div>
    </form>
  )
}
