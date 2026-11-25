/** Native iOS pageSheet for creating a new bot (triggered by the `+` orb), mirroring `web/src/bots/bot-create-page.tsx`. */
import * as Crypto from 'expo-crypto'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, TextInput, View } from 'react-native'
import { type Avatar, defaultAvatar } from '../../../shared/avatar'
import type { BotModel } from '../../../shared/bot-schema'
import { modelFromKey, modelGroups, modelKey } from '../../../shared/client/bots/model-choice'
import { messageOf } from '../../../shared/client/socket'
import { computeShellLayout } from '../duo/layout'
import { useBotSelection } from '../duo/selection'
import { useLiveSurface } from '../duo/use-surface'
import { BotAvatar } from '../ui/avatar'
import { CheckIcon, CloseIcon } from '../ui/icon'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { createBot } from './actions'
import { AvatarPicker, randomAvatar } from './avatar-picker'
import { useConnectionStore } from '../connection/store'
import { useBotMenuStore } from './menu-store'
import { useModelProviders } from './model-list'

export function NewBotSheet() {
  const open = useBotMenuStore(state => state.newBotOpen)
  const close = useBotMenuStore(state => state.closeNewBot)
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      {open ? <NewBotForm onClose={close} /> : null}
    </Modal>
  )
}

function NewBotForm({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  const keyboardHeight = useKeyboardHeight()
  const router = useRouter()
  const connected = useConnectionStore(state => state.connected)
  const providers = useModelProviders(connected)
  const select = useBotSelection(state => state.select)
  const { surface, metrics } = useLiveSurface()
  const splitMode = computeShellLayout(surface, metrics).splitMode

  const [avatar, setAvatar] = useState<Avatar>(() => defaultAvatar(Crypto.randomUUID()))
  const [name, setName] = useState('')
  const [fn, setFn] = useState('')
  const [instructions, setInstructions] = useState('')
  const [model, setModel] = useState<BotModel | null>(null)
  const [pickingModel, setPickingModel] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
  }, [name])

  const groups = modelGroups(providers ?? [], model)
  const modelLabel = model ? model.model : 'Same as the main bot'
  const inputStyle = {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.input,
    backgroundColor: theme.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: theme.foreground
  } as const

  const submit = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const bot = await createBot({ name: name.trim(), function: fn.trim(), instructions, avatar, model })
      select(bot.id)
      onClose()
      if (splitMode) router.replace('/(tabs)/(bots)')
      else router.push({ pathname: '/(tabs)/(bots)/chat', params: { botId: bot.id } })
    } catch (failure) {
      setError(messageOf(failure))
      setSaving(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
        <AppText variant="title">New bot</AppText>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <CloseIcon color={theme.foreground} />
        </Pressable>
      </View>

      <ScrollView
        {...KEYBOARD_SCROLL_PROPS}
        scrollIndicatorInsets={{ bottom: keyboardHeight }}
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: sheetScrollBottomPadding(40, keyboardHeight) }}
      >
        <View style={{ alignItems: 'center', gap: 10 }}>
          <BotAvatar name={name || 'New bot'} avatar={avatar} size={64} />
          <Pressable onPress={() => setAvatar(randomAvatar())} accessibilityRole="button" style={{ paddingVertical: 4, paddingHorizontal: 10 }}>
            <AppText variant="preview" color={theme.mutedForeground}>
              Surprise me
            </AppText>
          </Pressable>
        </View>

        <View style={{ gap: 6 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Name
          </AppText>
          <TextInput testID="new-bot-name" value={name} onChangeText={setName} maxLength={60} returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={() => Keyboard.dismiss()} placeholder="Researcher" placeholderTextColor={theme.mutedForeground} style={inputStyle} />
        </View>

        <AvatarPicker value={avatar} onChange={setAvatar} disabled={saving} />

        <View style={{ gap: 6 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Function
          </AppText>
          <AppText variant="meta" color={theme.mutedForeground}>
            What this bot is for, in a sentence or two.
          </AppText>
          <TextInput value={fn} onChangeText={setFn} maxLength={500} multiline placeholder="Finds and compares sources, then reports with links." placeholderTextColor={theme.mutedForeground} style={[inputStyle, { minHeight: 72, textAlignVertical: 'top' }]} />
        </View>

        <View style={{ gap: 6 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Instructions
          </AppText>
          <AppText variant="meta" color={theme.mutedForeground}>
            Personality and standing rules the bot follows in every chat.
          </AppText>
          <TextInput value={instructions} onChangeText={setInstructions} multiline placeholderTextColor={theme.mutedForeground} style={[inputStyle, { minHeight: 112, textAlignVertical: 'top' }]} />
        </View>

        <View style={{ gap: 6 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Model
          </AppText>
          <Pressable
            onPress={() => {
              Keyboard.dismiss()
              setPickingModel(open => !open)
            }}
            accessibilityRole="button"
            style={[inputStyle, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
          >
            <AppText variant="chat" numberOfLines={1} style={{ flex: 1 }}>
              {modelLabel}
            </AppText>
          </Pressable>
          {pickingModel && (
            <View style={{ backgroundColor: theme.card, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, padding: 6, gap: 2 }}>
              <Pressable onPress={() => { setModel(null); setPickingModel(false) }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.sm, backgroundColor: !model ? theme.muted : 'transparent' }}>
                <View style={{ width: 16 }}>{!model && <CheckIcon color={theme.foreground} />}</View>
                <AppText variant="preview">Same as the main bot</AppText>
              </Pressable>
              {groups.map(group => (
                <View key={group.label ?? 'default'} style={{ marginTop: 4 }}>
                  {group.label && <AppText variant="meta" color={theme.mutedForeground} style={{ paddingHorizontal: 8, paddingVertical: 2 }}>{group.label}</AppText>}
                  {group.options.map(opt => {
                    const active = opt.key === modelKey(model)
                    return (
                      <Pressable key={opt.key} onPress={() => { setModel(modelFromKey(opt.key)); setPickingModel(false) }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.sm, backgroundColor: active ? theme.muted : 'transparent' }}>
                        <View style={{ width: 16 }}>{active && <CheckIcon color={theme.foreground} />}</View>
                        <AppText variant="preview" numberOfLines={1} style={{ flex: 1 }}>{opt.label}</AppText>
                      </Pressable>
                    )
                  })}
                </View>
              ))}
            </View>
          )}
        </View>

        {error ? <AppText variant="preview" color={theme.destructive}>{error}</AppText> : null}

        <Pressable
          testID="new-bot-submit"
          disabled={saving || !name.trim()}
          onPress={() => void submit()}
          accessibilityRole="button"
          style={{ height: 46, borderRadius: radius.md, backgroundColor: theme.foreground, opacity: saving || !name.trim() ? 0.45 : 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <AppText variant="name" color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>
            {saving ? 'Saving...' : 'Create bot'}
          </AppText>
        </Pressable>
      </ScrollView>
    </View>
  )
}
