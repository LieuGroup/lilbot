/** Native pageSheet for deleting a bot, mirroring `web/src/bots/delete-bot-dialog.tsx` with shared copy helpers. */
import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, View } from 'react-native'
import type { BotDeleteDefaults } from '../../../shared/bot-delete-schema'
import type { Bot } from '../../../shared/bot-schema'
import { canDelete } from '../../../shared/client/bots/bot-menu-rules'
import { deleteSummary, filesHint, memoriesHint } from '../../../shared/client/bots/delete-copy'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useBotSelection } from '../duo/selection'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { deleteBot } from './actions'
import { useBotMenuStore } from './menu-store'
import { useBotStore } from './store'

const LOADING_CHOICES: BotDeleteDefaults = { files: 'archive', privateMemories: 'forget' }

export function DeleteBotSheet() {
  const dialog = useBotMenuStore(state => state.dialog)
  const close = useBotMenuStore(state => state.closeDialog)
  const bots = useBotStore(state => state.bots)
  const candidate = dialog?.kind === 'delete' ? (bots.find(item => item.id === dialog.botId) ?? null) : null
  const bot = candidate && canDelete(candidate) ? candidate : null

  return (
    <Modal visible={!!bot} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      {bot ? <ConfirmDelete bot={bot} onClose={close} /> : null}
    </Modal>
  )
}

function ConfirmDelete({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const theme = useTheme()
  const clearIfSelected = useBotSelection(state => state.clearIfSelected)
  const [choices, setChoices] = useState<BotDeleteDefaults | null>(null)
  const [routines, setRoutines] = useState<number | null>(null)
  const [facts, setFacts] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const socket = ensureSocket()
    if (!socket) {
      setError('Not connected to a LilBot server.')
      return
    }
    let alive = true
    socket.call('bots.deleteDefaults.get', {}).then(
      defaults => alive && setChoices(defaults),
      failure => alive && setError(messageOf(failure))
    )
    socket.call('routines.list', { botId: bot.id }).then(
      list => alive && setRoutines(list.length),
      () => alive && setRoutines(null)
    )
    socket.call('memory.list', { botId: bot.id }).then(
      memory => alive && setFacts(memory.facts.filter(fact => fact.botId === bot.id && fact.scope === 'bot').length),
      () => alive && setFacts(null)
    )
    return () => {
      alive = false
    }
  }, [bot.id])

  const active = choices ?? LOADING_CHOICES
  const disabled = !choices || deleting

  const confirm = async () => {
    if (!choices || deleting) return
    setDeleting(true)
    setError('')
    try {
      await deleteBot(bot.id, choices)
      clearIfSelected(bot.id)
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
      setDeleting(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
        <AppText variant="title">Delete {bot.name}?</AppText>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <CloseIcon color={theme.foreground} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
        <AppText variant="preview" color={theme.mutedForeground}>
          {deleteSummary(routines)}
        </AppText>

        <ChoiceGroup
          label="Files"
          hint={filesHint(active.files, 'dialog')}
          disabled={disabled}
          value={active.files}
          options={[
            { value: 'archive', label: 'Archive' },
            { value: 'delete', label: 'Delete' }
          ]}
          onChange={files => choices && setChoices({ ...choices, files })}
        />

        <ChoiceGroup
          label="Private memories"
          hint={memoriesHint(active.privateMemories, facts)}
          disabled={disabled}
          value={active.privateMemories}
          options={[
            { value: 'forget', label: 'Forget' },
            { value: 'keep', label: 'Keep' }
          ]}
          onChange={privateMemories => choices && setChoices({ ...choices, privateMemories })}
        />

        {error ? <AppText variant="preview" color={theme.destructive}>{error}</AppText> : null}

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingTop: 8 }}>
          <Pressable disabled={deleting} onPress={onClose} accessibilityRole="button" style={{ height: 42, paddingHorizontal: 14, borderRadius: radius.md, justifyContent: 'center' }}>
            <AppText variant="name" color={theme.mutedForeground}>
              Cancel
            </AppText>
          </Pressable>
          <Pressable
            disabled={disabled}
            onPress={() => void confirm()}
            accessibilityRole="button"
            style={{
              height: 42,
              paddingHorizontal: 16,
              borderRadius: radius.md,
              backgroundColor: theme.destructive,
              opacity: disabled ? 0.45 : 1,
              justifyContent: 'center'
            }}
          >
            <AppText variant="name" color="#ffffff" style={{ fontFamily: 'Inter_600SemiBold' }}>
              {deleting ? 'Deleting...' : 'Delete bot'}
            </AppText>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

function ChoiceGroup<T extends string>({
  label,
  hint,
  value,
  disabled,
  options,
  onChange
}: {
  label: string
  hint: string
  value: T
  disabled: boolean
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  const theme = useTheme()
  return (
    <View style={{ gap: 8, backgroundColor: theme.card, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, padding: 14 }}>
      <AppText variant="name" style={{ fontFamily: 'Inter_500Medium' }}>{label}</AppText>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {options.map(option => {
          const selected = value === option.value
          return (
            <Pressable
              key={option.value}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={{ flex: 1, height: 36, borderRadius: radius.sm, backgroundColor: selected ? theme.foreground : theme.muted, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}
            >
              <AppText variant="preview" color={selected ? theme.background : theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>{option.label}</AppText>
            </Pressable>
          )
        })}
      </View>
      <AppText variant="meta" color={theme.mutedForeground}>{hint}</AppText>
    </View>
  )
}
