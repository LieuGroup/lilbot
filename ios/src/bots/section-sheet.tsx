/** Native pageSheet for moving a bot to a section, creating a new section, and changing the primary bot (1:1 with web). */
import { useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, TextInput, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { BOT_MENU_LABELS, primaryCandidates } from '../../../shared/client/bots/bot-menu-rules'
import { messageOf } from '../../../shared/client/socket'
import { CheckIcon, CloseIcon, PlusIcon } from '../ui/icon'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { makeBotPrimary, moveToNewSection, setBotPrefs } from './actions'
import { useBotMenuStore } from './menu-store'
import { useBotStore } from './store'

export function SectionSheet() {
  const dialog = useBotMenuStore(state => state.dialog)
  const close = useBotMenuStore(state => state.closeDialog)
  const bots = useBotStore(state => state.bots)

  const botDialog =
    dialog && (dialog.kind === 'move-section' || dialog.kind === 'new-section' || dialog.kind === 'change-primary')
      ? { kind: dialog.kind, bot: bots.find(candidate => candidate.id === dialog.botId) ?? null }
      : null

  return (
    <Modal visible={!!botDialog?.bot} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      {botDialog?.bot && botDialog.kind === 'move-section' ? <MoveSectionView bot={botDialog.bot} onClose={close} /> : null}
      {botDialog?.bot && botDialog.kind === 'new-section' ? <NewSectionView bot={botDialog.bot} onClose={close} /> : null}
      {botDialog?.bot && botDialog.kind === 'change-primary' ? <ChangePrimaryView onClose={close} /> : null}
    </Modal>
  )
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
      <AppText variant="title">{title}</AppText>
      <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
        <CloseIcon color={theme.foreground} />
      </Pressable>
    </View>
  )
}

function MoveSectionView({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const theme = useTheme()
  const sections = useBotStore(state => state.sections)
  const openDialog = useBotMenuStore(state => state.openDialog)

  const pick = (sectionId: string | null) => {
    onClose()
    void setBotPrefs({ botId: bot.id, sectionId })
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SheetHeader title={BOT_MENU_LABELS.moveToSection} onClose={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {sections.map(section => {
          const active = bot.prefs.sectionId === section.id
          return (
            <Pressable key={section.id} onPress={() => pick(section.id)} accessibilityRole="button" style={{ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline }}>
              <View style={{ width: 16 }}>{active && <CheckIcon color={theme.foreground} />}</View>
              <AppText variant="chat" numberOfLines={1} style={{ flex: 1 }}>{section.name}</AppText>
            </Pressable>
          )
        })}
        <Pressable onPress={() => pick(null)} accessibilityRole="button" style={{ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline }}>
          <View style={{ width: 16 }}>{!bot.prefs.sectionId && <CheckIcon color={theme.foreground} />}</View>
          <AppText variant="chat">{BOT_MENU_LABELS.noSection}</AppText>
        </Pressable>
        <Pressable onPress={() => openDialog({ kind: 'new-section', botId: bot.id })} accessibilityRole="button" style={{ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: theme.muted }}>
          <PlusIcon color={theme.foreground} size={16} />
          <AppText variant="name" style={{ fontFamily: 'Inter_500Medium' }}>{BOT_MENU_LABELS.newSection}</AppText>
        </Pressable>
      </ScrollView>
    </View>
  )
}

function NewSectionView({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const theme = useTheme()
  const keyboardHeight = useKeyboardHeight()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      await moveToNewSection(bot.id, name.trim())
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
      setSaving(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SheetHeader title="New section" onClose={onClose} />
      <ScrollView
        {...KEYBOARD_SCROLL_PROPS}
        scrollIndicatorInsets={{ bottom: keyboardHeight }}
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: sheetScrollBottomPadding(24, keyboardHeight) }}
      >
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={40}
          autoFocus
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={() => void submit()}
          placeholder="Section name"
          placeholderTextColor={theme.mutedForeground}
          style={{ height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: theme.input, backgroundColor: theme.card, paddingHorizontal: 12, fontFamily: 'Inter_400Regular', fontSize: 15, color: theme.foreground }}
        />
        <AppText variant="meta" color={theme.mutedForeground}>{bot.name} moves into it.</AppText>
        {error ? <AppText variant="preview" color={theme.destructive}>{error}</AppText> : null}
        <Pressable disabled={saving || !name.trim()} onPress={() => void submit()} accessibilityRole="button" style={{ height: 44, borderRadius: radius.md, backgroundColor: theme.foreground, opacity: saving || !name.trim() ? 0.45 : 1, alignItems: 'center', justifyContent: 'center' }}>
          <AppText variant="name" color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>{saving ? 'Creating...' : 'Create'}</AppText>
        </Pressable>
      </ScrollView>
    </View>
  )
}

function ChangePrimaryView({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  const candidates = primaryCandidates(useBotStore(state => state.bots))

  const pick = (botId: string) => {
    onClose()
    void makeBotPrimary(botId)
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SheetHeader title={BOT_MENU_LABELS.changePrimaryBot} onClose={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {candidates.map(candidate => (
          <Pressable key={candidate.id} onPress={() => pick(candidate.id)} accessibilityRole="button" style={{ minHeight: 46, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline }}>
            <AppText variant="chat" numberOfLines={1}>{candidate.name}</AppText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}
