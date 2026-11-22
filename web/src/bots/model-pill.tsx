import { cn } from 'cn'
import { ChevronDownIcon, InfoIcon, LoaderCircleIcon } from 'lucide-react'
import { lazy, Suspense, useRef } from 'react'

import { InputGroupButton } from '@/ui/input-group'
import { modelPillView } from '../../../shared/client/bots/model-choice'
import { useBotStore } from './bot-store'
import { useModelProviders } from './model-list'
import { loadModelMenu, openModelMenu, useModelPicker } from './model-picker-target'

const ModelMenu = lazy(() => loadModelMenu().then(module => ({ default: module.ModelMenu })))
const NO_BOT = { model: null, reasoningEffort: null }

/** The bot's model and reasoning effort in the composer (Paper "14 Model picker"). It stays usable while the bot works;
 *  the menu it opens loads on first hover, focus or click. */
export function ModelPill({ botId, disabled }: { botId: string; disabled: boolean }) {
  const bot = useBotStore(state => state.bots.find(candidate => candidate.id === botId)) ?? NO_BOT
  const providers = useModelProviders()
  const saving = useModelPicker(state => (state.saving?.botId === botId ? state.saving.change : null))
  const open = useModelPicker(state => state.open)
  const used = useModelPicker(state => state.used)
  const pill = useRef<HTMLButtonElement>(null)
  const view = modelPillView(bot, providers, saving)
  const label = view.effort ? `${view.label} · ${view.effort}` : view.label

  return (
    <>
      <InputGroupButton
        ref={pill}
        size={null}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={view.saving}
        aria-label={`Model: ${label}${view.differs ? ', the engine sends another level' : ''}`}
        disabled={disabled}
        onPointerEnter={() => void loadModelMenu()}
        onFocus={() => void loadModelMenu()}
        onClick={openModelMenu}
        className={cn(
          'h-7 min-w-0 gap-1 rounded-full pr-2 pl-2.5 text-[13px]/[18px] font-medium text-muted-foreground hover:bg-foreground/6 hover:text-foreground aria-expanded:bg-foreground/6 aria-expanded:text-foreground',
          view.missing && 'text-destructive hover:text-destructive aria-expanded:text-destructive'
        )}
      >
        {view.saving && <LoaderCircleIcon className="size-3! animate-spin" strokeWidth={2} />}
        <span className="truncate">{label}</span>
        {view.differs && <InfoIcon className="size-[13px]!" strokeWidth={1.75} />}
        <ChevronDownIcon className="size-[13px]!" strokeWidth={2} />
      </InputGroupButton>
      {used && (
        <Suspense>
          <ModelMenu botId={botId} anchor={pill} />
        </Suspense>
      )}
    </>
  )
}
