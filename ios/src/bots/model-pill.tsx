/** The bot's model and reasoning effort in the composer. It stays usable while the bot works; the
 *  menu saves at once through bots.update and the roster store. */
import { type ReactNode, useState } from 'react'
import { ActivityIndicator, Keyboard, Pressable } from 'react-native'
import type { Bot, BotModel, ReasoningEffort } from '../../../shared/bot-schema'
import { LilBotError } from '../../../shared/lilbot-error'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { useTheme } from '../ui/theme'
import { AppText } from '../ui/text'
import { ChevronDownIcon, InfoIcon } from '../ui/icon'
import { useBotStore } from './store'
import { modelKey, modelPillView, type PickerChange } from './model-choice'
import { useModelProviders } from './model-list'
import { ModelMenu } from './model-menu'

/** Returns the pill for the composer row and the menu for the screen root, so the overlay is not trapped in the composer. */
export function useModelPicker(bot: Bot): { pill: ReactNode; menu: ReactNode } {
  const theme = useTheme()
  const connected = useConnectionStore(state => state.connected)
  const providers = useModelProviders(connected)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState<PickerChange | null>(null)
  const [note, setNote] = useState<{ message: string; tone: 'error' | 'info' } | null>(null)
  const view = modelPillView(bot, providers, saving)
  const label = view.effort ? `${view.label} · ${view.effort}` : view.label
  const ink = view.missing ? theme.destructive : theme.mutedForeground

  const save = async (change: PickerChange, what: 'model' | 'reasoning effort') => {
    const socket = ensureSocket()
    if (!socket) return
    setSaving(change)
    setNote(null)
    try {
      const detail = await socket.call('bots.update', { botId: bot.id, ...change })
      useBotStore.getState().upsert(detail)
      setOpen(false)
    } catch (failure) {
      if (failure instanceof LilBotError && failure.code === 'confirm_required') {
        setNote({ message: failure.message, tone: 'info' })
        await socket.call('bots.get', { botId: bot.id }).then(detail => useBotStore.getState().upsert(detail), () => undefined)
      } else {
        setNote({ message: `The ${what} was not changed. ${messageOf(failure)}`, tone: 'error' })
      }
    } finally {
      setSaving(null)
    }
  }

  const selectModel = (model: BotModel) => {
    if (modelKey(model) === modelKey(bot.model)) {
      setOpen(false)
      return
    }
    void save({ model }, 'model')
  }

  const selectEffort = (level: ReasoningEffort | null) => {
    if ((level ?? null) === (bot.reasoningEffort ?? null)) {
      setOpen(false)
      return
    }
    void save({ reasoningEffort: level }, 'reasoning effort')
  }

  const pill = (
    <Pressable
      testID="model-pill"
      accessibilityLabel={`Model: ${label}${view.differs ? ', the engine sends another level' : ''}`}
      accessibilityRole="button"
      disabled={!connected || !!saving}
      onPress={() => {
        Keyboard.dismiss()
        setNote(null)
        setOpen(true)
      }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, maxWidth: 260, paddingHorizontal: 10, borderRadius: 14, opacity: pressed ? 0.7 : 1 })}
    >
      {saving ? <ActivityIndicator size="small" color={ink} /> : null}
      <AppText variant="preview" numberOfLines={1} color={ink} style={{ flexShrink: 1 }}>
        {label}
      </AppText>
      {view.differs && <InfoIcon color={theme.primary} />}
      <ChevronDownIcon color={ink} />
    </Pressable>
  )
  const menu = <ModelMenu visible={open} bot={bot} providers={providers} saving={saving} note={note} onSelectModel={selectModel} onSelectEffort={selectEffort} onClose={() => setOpen(false)} />
  return { pill, menu }
}
