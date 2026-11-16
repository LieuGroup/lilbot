import { FolderIcon, PlusIcon, StarIcon } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/ui/dropdown-menu'
import type { Bot } from '../../../shared/bot-schema'
import { makePrimary, setPrefs } from './bot-actions'
import { primaryCandidates } from './bot-menu-rules'
import { useBotStore } from './bot-store'

const NONE = 'none'

/** "Move to section": the user's sections (the current one checked), "No section", then
 *  "New section…", which asks for a name and moves the bot there. */
export function SectionSubmenu({ bot, onNewSection }: { bot: Bot; onNewSection: () => void }) {
  const sections = useBotStore(state => state.sections)
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderIcon />
        Move to section
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {sections.length > 0 && (
          <>
            <DropdownMenuRadioGroup value={bot.prefs.sectionId ?? NONE} onValueChange={value => void setPrefs({ botId: bot.id, sectionId: value === NONE ? null : value })}>
              {sections.map(section => (
                <DropdownMenuRadioItem key={section.id} value={section.id} closeOnClick>
                  <span className="truncate">{section.name}</span>
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value={NONE} closeOnClick>
                No section
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator className="my-1" />
          </>
        )}
        <DropdownMenuItem onClick={onNewSection}>
          <PlusIcon />
          New section…
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** The primary bot's "Change primary bot": pick the bot that takes the mark. Only the mark
 *  moves; both bots stay as they are. */
export function PrimarySubmenu() {
  const candidates = useBotStore(state => primaryCandidates(state.bots))
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={candidates.length === 0}>
        <StarIcon />
        Change primary bot
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {candidates.map(candidate => (
          <DropdownMenuItem key={candidate.id} onClick={() => void makePrimary(candidate.id)}>
            <span className="truncate">{candidate.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
