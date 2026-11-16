import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import type { BotDeleteDefaults } from '../../../shared/bot-delete-schema'
import { filesHint, memoriesHint } from './delete-copy'

/** One labelled two-option switch. Clicking the chosen option again keeps it chosen. */
function ChoiceRow<T extends string>({
  label,
  hint,
  value,
  options,
  disabled,
  onChange
}: {
  label: string
  hint: string
  value: T
  options: { value: T; label: string }[]
  disabled?: boolean
  onChange: (value: T) => void
}) {
  return (
    <div className="flex items-center gap-4 py-3 pr-3 pl-3.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px]/[18px] font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <ToggleGroup
        aria-label={label}
        value={[value]}
        disabled={disabled}
        onValueChange={next => {
          const chosen = next[0] as T | undefined
          if (chosen && chosen !== value) onChange(chosen)
        }}
      >
        {options.map(option => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

/** The card both the delete dialog and Settings show: what happens to the bot's files and to
 *  its private memories. `facts` is the bot's private fact count (dialog only). */
export function DeleteChoices({
  value,
  place,
  facts = null,
  disabled,
  onChange
}: {
  value: BotDeleteDefaults
  place: 'dialog' | 'settings'
  facts?: number | null
  disabled?: boolean
  onChange: (value: BotDeleteDefaults) => void
}) {
  return (
    <div className="flex flex-col rounded-xl bg-background">
      <ChoiceRow
        label="Files"
        hint={filesHint(value.files, place)}
        value={value.files}
        disabled={disabled}
        options={[
          { value: 'archive', label: 'Archive' },
          { value: 'delete', label: 'Delete' }
        ]}
        onChange={files => onChange({ ...value, files })}
      />
      <div className="h-px bg-foreground/6" />
      <ChoiceRow
        label="Private memories"
        hint={memoriesHint(value.privateMemories, place === 'dialog' ? facts : null)}
        value={value.privateMemories}
        disabled={disabled}
        options={[
          { value: 'forget', label: 'Forget' },
          { value: 'keep', label: 'Keep' }
        ]}
        onChange={privateMemories => onChange({ ...value, privateMemories })}
      />
    </div>
  )
}
