import { ChevronDownIcon } from 'lucide-react'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import type { BotModel, ModelProvider } from '../../../shared/bot-schema'
import { type ModelGroup, modelFromKey, modelGroups, modelKey, modelLabel } from '../../../shared/client/bots/model-choice'

// Paper "14 Model picker": the tick sits before the current model, other names are indented to line up with it.
export const choiceRow =
  'pr-2 pl-8 data-checked:bg-foreground/6 data-checked:font-medium [&>[data-slot=dropdown-menu-radio-item-indicator]]:right-auto [&>[data-slot=dropdown-menu-radio-item-indicator]]:left-2 [&_svg]:size-3.5! [&_svg]:stroke-[2.5]!'

/** The models grouped under their provider's name, with a tick on the current one. Choosing one closes the menu. */
export function ModelChoices({ groups, value, onChange }: { groups: ModelGroup[]; value: BotModel | null; onChange: (model: BotModel | null) => void }) {
  return (
    <DropdownMenuRadioGroup value={modelKey(value)} onValueChange={key => onChange(modelFromKey(key))}>
      {groups.map(group => (
        <DropdownMenuGroup key={group.label ?? 'top'}>
          {group.label && <DropdownMenuLabel className="pt-2 pb-0.5">{group.label}</DropdownMenuLabel>}
          {group.options.map(option => (
            <DropdownMenuRadioItem key={option.key} value={option.key} label={option.label} closeOnClick className={choiceRow}>
              <span className="truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuGroup>
      ))}
    </DropdownMenuRadioGroup>
  )
}

interface ModelSelectorProps {
  id?: string
  providers: ModelProvider[]
  value: BotModel | null
  /** Offered first when the bot may have no model of its own, e.g. "Same as the main bot". */
  noModelLabel?: string
  onChange: (model: BotModel | null) => void
}

/** The Model Selector pattern as a form field (Setup and New bot); the composer's pill opens the same choices. */
export function ModelSelector({ id, providers, value, noModelLabel, onChange }: ModelSelectorProps) {
  const groups = modelGroups(providers, value, noModelLabel)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button id={id} type="button" variant="outline" size="lg" className="w-full justify-between font-normal" />}>
        <span className="truncate">{modelLabel(groups, value)}</span>
        <ChevronDownIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(24rem,var(--available-height))] w-(--anchor-width)">
        <ModelChoices groups={groups} value={value} onChange={onChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
