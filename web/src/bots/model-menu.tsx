import type { RefObject } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuEmpty, DropdownMenuFilter, DropdownMenuInput, DropdownMenuList, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import type { BotModel } from '../../../shared/bot-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useBotStore } from './bot-store'
import { modelGroups, modelKey } from './model-choice'
import { useModelList } from './model-list'
import { useModelPicker } from './model-picker-target'
import { ModelChoices } from './model-selector'

/** Save the bot's model at once. The pill shows the new model with a spinner meanwhile; a refusal
 *  puts the saved model back and shows a red note in the composer. */
async function chooseModel(botId: string, model: BotModel | null) {
  const current = useBotStore.getState().bots.find(bot => bot.id === botId)?.model ?? null
  if (!model || modelKey(model) === modelKey(current)) return
  useModelPicker.setState({ saving: { botId, model }, error: null })
  try {
    useBotStore.getState().upsert(await lilbot.call('bots.update', { botId, model }))
  } catch (failure) {
    useModelPicker.setState({ error: { botId, message: messageOf(failure) } })
  } finally {
    useModelPicker.setState({ saving: null })
  }
}

const close = (open: boolean) => !open && useModelPicker.getState().open && useModelPicker.setState({ open: false, closedAt: Date.now() })

/** The composer's model menu (Paper "14 Model picker"): find a model, the models by provider with
 *  a tick on the current one, and what a change does. It opens upward from the pill. */
export function ModelMenu({ botId, anchor }: { botId: string; anchor: RefObject<HTMLButtonElement | null> }) {
  const open = useModelPicker(state => state.open)
  const bot = useBotStore(state => state.bots.find(candidate => candidate.id === botId))
  const providers = useModelList(state => state.providers)
  const value = bot?.model ?? null
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
            <ModelChoices groups={modelGroups(providers ?? [], null)} value={value} onChange={model => void chooseModel(botId, model)} />
            <DropdownMenuEmpty>{providers ? 'No model matches.' : 'Loading models...'}</DropdownMenuEmpty>
          </DropdownMenuList>
          <DropdownMenuSeparator className="my-0.5" />
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Changes {bot?.name}'s model. Applies after New session.</p>
        </DropdownMenuContent>
      </DropdownMenu>
    </DropdownMenuFilter>
  )
}
