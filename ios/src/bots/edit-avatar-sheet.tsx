/** Native pageSheet for editing a bot's name and avatar, mirroring `web/src/bots/edit-avatar-dialog.tsx`. */
import { useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, TextInput, View } from 'react-native'
import type { Avatar } from '../../../shared/avatar'
import type { Bot } from '../../../shared/bot-schema'
import { messageOf } from '../../../shared/client/socket'
import { BotAvatar } from '../ui/avatar'
import { CloseIcon } from '../ui/icon'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { saveNameAndAvatar } from './actions'
import { AvatarPicker, randomAvatar } from './avatar-picker'
import { useBotMenuStore } from './menu-store'
import { useBotStore } from './store'

export function EditAvatarSheet() {
  const dialog = useBotMenuStore(state => state.dialog)
  const close = useBotMenuStore(state => state.closeDialog)
  const bots = useBotStore(state => state.bots)
  const bot = dialog?.kind === 'name-and-avatar' ? (bots.find(candidate => candidate.id === dialog.botId) ?? null) : null

  return (
    <Modal visible={!!bot} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      {bot ? <Editor bot={bot} onClose={close} /> : null}
    </Modal>
  )
}

function Editor({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const theme = useTheme()
  const keyboardHeight = useKeyboardHeight()
  const [name, setName] = useState(bot.name)
  const [avatar, setAvatar] = useState<Avatar>(bot.prefs.avatar)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      await saveNameAndAvatar(bot.id, bot.name, { name: name.trim(), avatar })
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
      setSaving(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
        <AppText variant="title">Name and avatar</AppText>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <CloseIcon color={theme.foreground} />
        </Pressable>
      </View>

      <ScrollView
        {...KEYBOARD_SCROLL_PROPS}
        scrollIndicatorInsets={{ bottom: keyboardHeight }}
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: sheetScrollBottomPadding(40, keyboardHeight) }}
      >
        <View style={{ alignItems: 'center', gap: 12 }}>
          <BotAvatar name={name || bot.name} avatar={avatar} size={80} />
          <TextInput
            accessibilityLabel="Name"
            value={name}
            onChangeText={setName}
            maxLength={60}
            editable={!saving}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => Keyboard.dismiss()}
            style={{
              width: '100%',
              height: 44,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: theme.input,
              backgroundColor: theme.card,
              paddingHorizontal: 12,
              textAlign: 'center',
              fontFamily: 'Inter_500Medium',
              fontSize: 15,
              color: theme.foreground
            }}
          />
        </View>

        <AvatarPicker value={avatar} onChange={setAvatar} disabled={saving} />

        {error ? <AppText variant="preview" color={theme.destructive}>{error}</AppText> : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
          <Pressable disabled={saving} onPress={() => setAvatar(randomAvatar())} accessibilityRole="button" style={{ paddingVertical: 8, paddingHorizontal: 4 }}>
            <AppText variant="preview" color={theme.mutedForeground}>
              Surprise me
            </AppText>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable disabled={saving} onPress={onClose} accessibilityRole="button" style={{ height: 40, paddingHorizontal: 14, borderRadius: radius.md, justifyContent: 'center' }}>
              <AppText variant="name" color={theme.mutedForeground}>
                Cancel
              </AppText>
            </Pressable>
            <Pressable
              disabled={saving || !name.trim()}
              onPress={() => void save()}
              accessibilityRole="button"
              style={{
                height: 40,
                paddingHorizontal: 18,
                borderRadius: radius.md,
                backgroundColor: theme.foreground,
                opacity: saving || !name.trim() ? 0.45 : 1,
                justifyContent: 'center'
              }}
            >
              <AppText variant="name" color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>
                {saving ? 'Saving...' : 'Save'}
              </AppText>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
