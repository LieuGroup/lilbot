import type { RefObject } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuFilter,
  DropdownMenuInput,
  DropdownMenuList,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/ui/dropdown-menu'
import { LilBotError } from '../../../shared/protocol'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useBotStore } from './bot-store'
import { EffortChoices } from './effort-choices'
import { modelGroups, modelKey, type PickerChange } from './model-choice'
import { useModelList } from './model-list'
import { useModelPicker } from './model-picker-target'
import { ModelChoices } from './model-selector'
import { capabilityOf, effortValue, reasons } from './reasoning-effort'

/** Save at once. The pill shows the new value with a spinner meanwhile. A refusal puts the saved value back with a red note;
 *  a switch the open conversation could not take is saved for new conversations, and the note says so. */
async function save(botId: string, change: PickerChange, what: 'model' | 'reasoning effort') {
  useModelPicker.setState({ saving: { botId, change }, note: null })
  const { upsert } = useBotStore.getState()
  try {
    upsert(await lilbot.call('bots.update', { botId, ...change }))
  } catch (failure) {
    if (failure instanceof LilBotError && failure.code === 'confirm_required') {
      useModelPicker.setState({ note: { botId, message: failure.message, tone: 'info' } })
      await lilbot.call('bots.get', { botId }).then(upsert, () => undefined)
    } else useModelPicker.setState({ note: { botId, message: `The ${what} was not changed. ${messageOf(failure)}`, tone: 'error' } })
  } finally {
    useModelPicker.setState({ saving: null })
  }
}

const close = (open: boolean) => !open && useModelPicker.getState().open && useModelPicker.setState({ open: false, closedAt: Date.now() })

/** The composer's model menu (Paper "14 Model picker"): find a model, the models by provider with a tick on the current
 *  one, the reasoning effort (for a model that reasons) and what a change does. It opens upward from the pill. */
export function ModelMenu({ botId, anchor }: { botId: string; anchor: RefObject<HTMLButtonElement | null> }) {
  const open = useModelPicker(state => state.open)
  const bot = useBotStore(state => state.bots.find(candidate => candidate.id === botId))
  const providers = useModelList(state => state.providers)
  const model = bot?.model ?? null
  const capability = capabilityOf(providers, model)
  const effort = bot?.reasoningEffort ?? null
  return (
    <DropdownMenuFilter>
      <DropdownMenu open={open && !!bot} onOpenChange={close}>
        <DropdownMenuContent
          anchor={anchor}
          side="top"
          align="start"
          sideOffset={8}
          finalFocus={anchor}
          className="max-h-[min(30rem,var(--available-height))] w-[280px] max-w-[calc(100vw-32px)] gap-0.5 overflow-hidden rounded-[8px] bg-card"
        >
          <DropdownMenuInput placeholder="Find a model" aria-label="Find a model" />
          <DropdownMenuList>
            <ModelChoices
              groups={modelGroups(providers ?? [], null)}
              value={model}
              onChange={next => next && modelKey(next) !== modelKey(model) && void save(botId, { model: next }, 'model')}
            />
            <DropdownMenuEmpty>{providers ? 'No model matches.' : 'Loading models...'}</DropdownMenuEmpty>
          </DropdownMenuList>
          {reasons(capability) && (
            <>
              <DropdownMenuSeparator className="my-0.5" />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="h-auto min-h-[30px] flex-none py-1.5">
                  <span className="flex-none">Reasoning effort</span>
                  <span className="ml-auto min-w-0 text-right text-muted-foreground">{effortValue(effort, bot?.effectiveReasoningEffort)}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-[196px] rounded-[8px] bg-card">
                  <EffortChoices
                    value={effort}
                    canDisable={capability?.canDisableReasoning}
                    onChange={level => level !== effort && void save(botId, { reasoningEffort: level }, 'reasoning effort')}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
          <DropdownMenuSeparator className="my-0.5" />
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Changes {bot?.name}'s model and effort, from the next message.</p>
        </DropdownMenuContent>
      </DropdownMenu>
    </DropdownMenuFilter>
  )
}
