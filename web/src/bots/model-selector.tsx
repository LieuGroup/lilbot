import { ChevronDownIcon } from 'lucide-react'
import { Fragment } from 'react'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/ui/dropdown-menu'
import type { BotModel, ModelProvider } from '../../../shared/bot-schema'
import { modelFromKey, modelGroups, modelKey, modelLabel } from './model-choice'

interface ModelSelectorProps {
  id?: string
  providers: ModelProvider[]
  value: BotModel | null
  /** Offered first when the bot may have no model of its own, e.g. "Same as the main bot". */
  noModelLabel?: string
  onChange: (model: BotModel | null) => void
}

/** The Model Selector pattern, model menu only: the engine has no effort setting per bot. */
export function ModelSelector({ id, providers, value, noModelLabel, onChange }: ModelSelectorProps) {
  const groups = modelGroups(providers, value, noModelLabel)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button id={id} type="button" variant="outline" size="lg" className="w-full justify-between font-normal" />}>
        <span className="truncate">{modelLabel(groups, value)}</span>
        <ChevronDownIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(24rem,var(--available-height))]">
        <DropdownMenuRadioGroup value={modelKey(value)} onValueChange={key => onChange(modelFromKey(key))}>
          {groups.map((group, index) => (
            <Fragment key={group.label ?? 'top'}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                {group.label && <DropdownMenuLabel>{group.label}</DropdownMenuLabel>}
                {group.options.map(option => (
                  <DropdownMenuRadioItem key={option.key} value={option.key} closeOnClick>
                    <span className="truncate">{option.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
