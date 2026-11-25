/** The bot's model and reasoning effort in the composer. Keeps the effort suffix ("· High")
 *  visible even when a long model name shortens on narrow Folded Duo widths, and exposes `open()`
 *  so long-press Send and text-only ImageNote reuse the same picker modal. */
import { type ReactNode, useCallback, useState } from 'react'
import { ActivityIndicator, Keyboard, Pressable } from 'react-native'
import type { Bot, BotModel, ReasoningEffort } from '../../../shared/bot-schema'
import { modelKey, modelPillView, type PickerChange } from '../../../shared/client/bots/model-choice'
import { messageOf } from '../../../shared/client/socket'
import { LilBotError } from '../../../shared/lilbot-error'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { ChevronDownIcon, InfoIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { useModelProviders } from './model-list'
import { ModelMenu } from './model-menu'
import { modelPillSegments } from './model-pill-format'
import { useBotStore } from './store'

/** Returns the pill for the composer toolbar, the modal menu for the screen root, and `open()`. */
export function useModelPicker(bot: Bot): { pill: ReactNode; menu: ReactNode; open: () => void } {
  const theme = useTheme()
  const connected = useConnectionStore(state => state.connected)
  const providers = useModelProviders(connected)
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState<PickerChange | null>(null)
  const [note, setNote] = useState<{ message: string; tone: 'error' | 'info' } | null>(null)
  const view = modelPillView(bot, providers, saving)
  const segments = modelPillSegments(view)
  const ink = view.missing ? theme.destructive : theme.mutedForeground

  const open = useCallback(() => {
    if (!connected || saving) return
    Keyboard.dismiss()
    setNote(null)
    setVisible(true)
  }, [connected, saving])

  const save = async (change: PickerChange, what: 'model' | 'reasoning effort') => {
    const socket = ensureSocket()
    if (!socket) return
    setSaving(change)
    setNote(null)
    try {
      const detail = await socket.call('bots.update', { botId: bot.id, ...change })
      useBotStore.getState().upsert(detail)
      setVisible(false)
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
      setVisible(false)
      return
    }
    void save({ model }, 'model')
  }

  const selectEffort = (level: ReasoningEffort | null) => {
    if ((level ?? null) === (bot.reasoningEffort ?? null)) {
      setVisible(false)
      return
    }
    void save({ reasoningEffort: level }, 'reasoning effort')
  }

  const pill = (
    <Pressable
      testID="model-pill"
      accessibilityLabel={segments.accessibilityLabel}
      accessibilityRole="button"
      disabled={!connected || !!saving}
      onPress={open}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        minHeight: 30,
        maxWidth: '100%',
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 9999,
        backgroundColor: theme.muted,
        flexShrink: 1,
        opacity: pressed ? 0.7 : 1
      })}
    >
      {saving ? <ActivityIndicator size="small" color={ink} /> : null}
      <AppText variant="preview" numberOfLines={1} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill} color={ink} style={{ flexShrink: 1 }}>
        {segments.model}
      </AppText>
      {segments.effortSuffix ? (
        <AppText variant="preview" numberOfLines={1} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill} color={ink} style={{ flexShrink: 0 }}>
          {segments.effortSuffix}
        </AppText>
      ) : null}
      {view.differs && <InfoIcon color={theme.primary} />}
      <ChevronDownIcon color={ink} size={13} />
    </Pressable>
  )
  const menu = <ModelMenu visible={visible} bot={bot} providers={providers} saving={saving} note={note} onSelectModel={selectModel} onSelectEffort={selectEffort} onClose={() => setVisible(false)} />
  return { pill, menu, open }
}
