import { type FormEvent, useState } from 'react'
import { Button } from '@/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Textarea } from '@/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import type { Bot } from '../../../shared/bot-schema'

interface AddFactFormProps {
  bots: Bot[]
  /** Open on "Only this bot" when adding from one bot's page. */
  botId?: string
  busy: boolean
  /** Resolves once the fact is saved; the form then closes. */
  onAdd: (fact: { botId: string; shared: boolean; text: string }) => Promise<boolean>
  onCancel: () => void
}

/** Add a fact by hand: one line of text and who knows it. A fact typed here always lasts. */
export function AddFactForm({ bots, botId, busy, onAdd, onCancel }: AddFactFormProps) {
  const primary = bots.find(bot => bot.isPrimary) ?? bots[0]
  const [text, setText] = useState('')
  const [shared, setShared] = useState(!botId)
  const [owner, setOwner] = useState(botId ?? primary?.id ?? '')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await onAdd({ botId: shared ? (primary?.id ?? owner) : owner, shared, text })) setText('')
  }

  return (
    <form onSubmit={submit} className="flex flex-none flex-col gap-2.5 rounded-xl bg-background p-3">
      <span className="text-[13px]/[18px] font-medium">Add a fact</span>
      <Textarea
        autoFocus
        value={text}
        maxLength={500}
        aria-label="Fact to remember"
        placeholder="Release notes always as a table."
        className="min-h-14 bg-card text-[13px]/[19px] md:text-[13px]/[19px] dark:bg-card"
        onChange={event => setText(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Who knows it</span>
        <ToggleGroup aria-label="Who knows it" value={[shared ? 'all' : 'one']} onValueChange={next => next[0] && setShared(next[0] === 'all')}>
          <ToggleGroupItem value="all">All bots</ToggleGroupItem>
          <ToggleGroupItem value="one">One bot</ToggleGroupItem>
        </ToggleGroup>
        {!shared && (
          <Select value={owner} onValueChange={value => value && setOwner(value)}>
            <SelectTrigger size="sm" aria-label="Which bot" className="text-xs">
              <SelectValue>{bots.find(bot => bot.id === owner)?.name ?? 'Choose a bot'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {bots.map(bot => (
                <SelectItem key={bot.id} value={bot.id}>
                  {bot.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex-1" />
        <Button type="button" variant="ghost" size="sm" className="h-7 text-[13px]" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-7 text-[13px]" disabled={busy || !text.trim() || !owner}>
          Save
        </Button>
      </div>
    </form>
  )
}
