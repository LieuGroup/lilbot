import { cn } from 'cn'
import { ChevronDownIcon, LoaderCircleIcon } from 'lucide-react'
import { lazy, Suspense, useRef } from 'react'

import { InputGroupButton } from '@/ui/input-group'
import { useBotStore } from './bot-store'
import { modelPillView } from './model-choice'
import { useModelProviders } from './model-list'
import { loadModelMenu, openModelMenu, useModelPicker } from './model-picker-target'

const ModelMenu = lazy(() => loadModelMenu().then(module => ({ default: module.ModelMenu })))

/** The bot's model in the composer (Paper "14 Model picker"). It stays usable while the bot works;
 *  the menu it opens loads on first hover, focus or click. */
export function ModelPill({ botId, disabled }: { botId: string; disabled: boolean }) {
  const model = useBotStore(state => state.bots.find(bot => bot.id === botId)?.model ?? null)
  const providers = useModelProviders()
  const saving = useModelPicker(state => (state.saving?.botId === botId ? state.saving.model : null))
  const open = useModelPicker(state => state.open)
  const used = useModelPicker(state => state.used)
  const pill = useRef<HTMLButtonElement>(null)
  const view = modelPillView(model, providers, saving)

  return (
    <>
      <InputGroupButton
        ref={pill}
        size={null}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={view.saving}
        aria-label={`Model: ${view.label}`}
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
        <span className="truncate">{view.label}</span>
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
