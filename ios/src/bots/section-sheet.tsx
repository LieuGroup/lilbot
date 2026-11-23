/** Native pageSheet for section management (move to section, new section, rename/delete section) and changing primary bot. */
import { useState } from 'react'
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { primaryCandidates } from '../../../shared/client/bots/bot-menu-rules'
import { messageOf } from '../../../shared/client/socket'
import { CheckIcon, CloseIcon, PlusIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { deleteSection, makeBotPrimary, moveToNewSection, renameSection, setBotPrefs } from './actions'
import { type SectionDialogState, useBotMenuStore } from './menu-store'
import { useBotStore } from './store'

export function SectionSheet() {
  const dialog = useBotMenuStore(state => state.dialog)
  const sectionDialog = useBotMenuStore(state => state.sectionDialog)
  const closeDialog = useBotMenuStore(state => state.closeDialog)
  const closeSectionDialog = useBotMenuStore(state => state.closeSectionDialog)
  const bots = useBotStore(state => state.bots)

  const botDialog =
    dialog && (dialog.kind === 'move-section' || dialog.kind === 'new-section' || dialog.kind === 'change-primary')
      ? { kind: dialog.kind, bot: bots.find(candidate => candidate.id === dialog.botId) ?? null }
      : null

  const visible = !!botDialog?.bot || !!sectionDialog
  const close = () => {
    closeDialog()
    closeSectionDialog()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      {botDialog?.bot && botDialog.kind === 'move-section' ? <MoveSectionView bot={botDialog.bot} onClose={close} /> : null}
      {botDialog?.bot && botDialog.kind === 'new-section' ? <NewSectionView bot={botDialog.bot} onClose={close} /> : null}
      {botDialog?.bot && botDialog.kind === 'change-primary' ? <ChangePrimaryView onClose={close} /> : null}
      {sectionDialog ? <ManageSectionView dialog={sectionDialog} onClose={close} /> : null}
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
      <SheetHeader title="Move to section" onClose={onClose} />
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
          <AppText variant="chat">No section</AppText>
        </Pressable>
        <Pressable onPress={() => openDialog({ kind: 'new-section', botId: bot.id })} accessibilityRole="button" style={{ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: theme.muted }}>
          <PlusIcon color={theme.foreground} size={16} />
          <AppText variant="name" style={{ fontFamily: 'Inter_500Medium' }}>New section…</AppText>
        </Pressable>
      </ScrollView>
    </View>
  )
}

function NewSectionView({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const theme = useTheme()
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
      <View style={{ padding: 16, gap: 14 }}>
        <TextInput value={name} onChangeText={setName} maxLength={40} autoFocus placeholder="Section name" placeholderTextColor={theme.mutedForeground} style={{ height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: theme.input, backgroundColor: theme.card, paddingHorizontal: 12, fontFamily: 'Inter_400Regular', fontSize: 15, color: theme.foreground }} />
        <AppText variant="meta" color={theme.mutedForeground}>{bot.name} moves into it.</AppText>
        {error ? <AppText variant="preview" color={theme.destructive}>{error}</AppText> : null}
        <Pressable disabled={saving || !name.trim()} onPress={() => void submit()} accessibilityRole="button" style={{ height: 44, borderRadius: radius.md, backgroundColor: theme.foreground, opacity: saving || !name.trim() ? 0.45 : 1, alignItems: 'center', justifyContent: 'center' }}>
          <AppText variant="name" color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>{saving ? 'Creating...' : 'Create'}</AppText>
        </Pressable>
      </View>
    </View>
  )
}

function ChangePrimaryView({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  const candidates = primaryCandidates(useBotStore(state => state.bots))
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SheetHeader title="Change primary bot" onClose={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {candidates.map(candidate => (
          <Pressable key={candidate.id} onPress={() => { onClose(); void makeBotPrimary(candidate.id) }} accessibilityRole="button" style={{ minHeight: 46, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline }}>
            <AppText variant="chat" numberOfLines={1}>{candidate.name}</AppText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

function ManageSectionView({ dialog, onClose }: { dialog: SectionDialogState; onClose: () => void }) {
  const theme = useTheme()
  const [name, setName] = useState(dialog.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const saveRename = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await renameSection(dialog.sectionId, name.trim())
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await deleteSection(dialog.sectionId)
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SheetHeader title="Section" onClose={onClose} />
      <View style={{ padding: 16, gap: 14 }}>
        <TextInput value={name} onChangeText={setName} maxLength={40} placeholder="Section name" placeholderTextColor={theme.mutedForeground} style={{ height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: theme.input, backgroundColor: theme.card, paddingHorizontal: 12, fontFamily: 'Inter_400Regular', fontSize: 15, color: theme.foreground }} />
        {error ? <AppText variant="preview" color={theme.destructive}>{error}</AppText> : null}
        <Pressable disabled={busy || !name.trim()} onPress={() => void saveRename()} accessibilityRole="button" style={{ height: 44, borderRadius: radius.md, backgroundColor: theme.foreground, opacity: busy || !name.trim() ? 0.45 : 1, alignItems: 'center', justifyContent: 'center' }}>
          <AppText variant="name" color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>Rename section</AppText>
        </Pressable>
        <Pressable disabled={busy} onPress={() => void remove()} accessibilityRole="button" style={{ height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: theme.destructive, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.45 : 1 }}>
          <AppText variant="name" color={theme.destructive} style={{ fontFamily: 'Inter_600SemiBold' }}>Delete section</AppText>
        </Pressable>
      </View>
    </View>
  )
}
