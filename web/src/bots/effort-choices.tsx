import { ChevronDownIcon } from 'lucide-react'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { ReasoningEffort } from '../../../shared/bot-schema'
import { effortLabel } from '../../../shared/client/bots/reasoning-effort'
import { choiceRow } from './model-selector'

const LEVELS = ReasoningEffort.options.filter(level => level !== 'none')
const DEFAULT = ''

interface EffortChoicesProps {
  value: ReasoningEffort | null
  /** False hides "Off"; null (the engine does not say) keeps it with "if the model allows". */
  canDisable: boolean | null | undefined
  onChange: (level: ReasoningEffort | null) => void
}

/** The levels with a tick on the chosen one (Paper "14 Model picker"): the same list for every model that reasons,
 *  since the engine does not say which levels a model takes. Choosing one closes the menu. */
export function EffortChoices({ value, canDisable, onChange }: EffortChoicesProps) {
  const item = (level: ReasoningEffort | typeof DEFAULT, hint?: string) => (
    <DropdownMenuRadioItem key={level} value={level} label={effortLabel(level || null)} closeOnClick className={choiceRow}>
      <span className="truncate">{effortLabel(level || null)}</span>
      {hint && <span className="ml-auto flex-none text-xs whitespace-nowrap text-muted-foreground">{hint}</span>}
    </DropdownMenuRadioItem>
  )
  return (
    <DropdownMenuRadioGroup value={value ?? DEFAULT} onValueChange={(level: string) => onChange(level ? ReasoningEffort.parse(level) : null)}>
      {item(DEFAULT)}
      {canDisable !== false && item('none', canDisable ? undefined : 'if the model allows')}
      <DropdownMenuSeparator className="my-0.5" />
      {LEVELS.map(level => item(level))}
    </DropdownMenuRadioGroup>
  )
}

/** The effort as a form field (Setup); the composer's menu opens the same choices. */
export function EffortSelector({ id, ...choices }: EffortChoicesProps & { id: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button id={id} type="button" variant="outline" size="lg" className="w-full justify-between font-normal" />}>
        <span className="truncate">{effortLabel(choices.value)}</span>
        <ChevronDownIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--anchor-width)">
        <EffortChoices {...choices} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
