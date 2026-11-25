/** Bot Details > Setup tab (`R3-05`): primary bot action, identity/instructions/model form (`bots.get` + `bots.update`),
 *  workspace path, shared Skills section with per-bot switches, and read-only Toolsets/Connectors summary. */
import { useEffect, useState } from 'react'
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import type { Ability, Bot, BotDetail } from '../../../shared/bot-schema'
import { primaryCandidates } from '../../../shared/client/bots/bot-menu-rules'
import { modelKey } from '../../../shared/client/bots/model-choice'
import { messageOf } from '../../../shared/client/socket'
import { LilBotError } from '../../../shared/lilbot-error'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { SkillsSection } from '../skills/skills-section'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { StarIcon } from '../ui/icon'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { makeBotPrimary } from './actions'
import { useBotMenuStore } from './menu-store'
import { useModelProviders } from './model-list'
import { SetupForm } from './setup-form'
import { useBotStore } from './store'

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' })
const ABILITY_KINDS: readonly { kind: Ability['kind']; label: string }[] = [
  { kind: 'toolset', label: 'Toolsets' },
  { kind: 'connector', label: 'Connectors' }
]

export function SetupTab({ bot, bottomPadding = 28 }: { bot: Bot; bottomPadding?: number }) {
  const theme = useTheme()
  const keyboardHeight = useKeyboardHeight()
  const { fontScale } = useWindowDimensions()
  const stackWide = fontScale >= 1.35
  const connected = useConnectionStore(state => state.connected)
  const bots = useBotStore(state => state.bots)
  const upsert = useBotStore(state => state.upsert)
  const openDialog = useBotMenuStore(state => state.openDialog)
  const providers = useModelProviders(connected)
  const [loaded, setLoaded] = useState<BotDetail | null>(null)
  const [error, setError] = useState('')
  const [keptNotice, setKeptNotice] = useState('')
  const detail = loaded?.id === bot.id ? loaded : null
  const modelId = modelKey(bot.model)

  useEffect(() => {
    if (!connected) return
    const socket = ensureSocket()
    if (!socket) return
    let cancelled = false
    setError('')
    socket
      .call('bots.get', { botId: bot.id })
      .then(result => {
        if (!cancelled) setLoaded(result)
      })
      .catch(failure => {
        if (!cancelled) setError(messageOf(failure))
      })
    return () => {
      cancelled = true
    }
  }, [bot.id, bot.name, bot.reasoningEffort, bot.effectiveReasoningEffort, connected, modelId])

  const canChangePrimary = primaryCandidates(bots).length > 0

  return (
    <ScrollView testID="bot-details-setup" scrollIndicatorInsets={{ bottom: keyboardHeight }} contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: sheetScrollBottomPadding(bottomPadding, keyboardHeight) }} {...KEYBOARD_SCROLL_PROPS}>
      {error ? (
        <AppText variant="preview" color={theme.destructive}>
          {error}
        </AppText>
      ) : null}
      {!detail && !error ? (
        <AppText variant="preview" color={theme.mutedForeground}>
          Loading…
        </AppText>
      ) : null}

      {detail ? (
        <>
          <SectionGroup title="Primary bot">
            <View style={{ flexDirection: stackWide ? 'column' : 'row', alignItems: stackWide ? 'flex-start' : 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, gap: stackWide ? 10 : 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: stackWide ? 0 : 1, width: stackWide ? '100%' : undefined }}>
                <StarIcon color={bot.isPrimary ? theme.foreground : theme.mutedForeground} size={15} />
                <AppText variant="preview" color={bot.isPrimary ? theme.foreground : theme.mutedForeground} style={{ flex: 1 }}>
                  {bot.isPrimary ? 'Primary bot (opens first)' : 'Not the primary bot'}
                </AppText>
              </View>
              <Pressable
                disabled={bot.isPrimary && !canChangePrimary}
                onPress={() => {
                  if (bot.isPrimary) openDialog({ kind: 'change-primary', botId: bot.id })
                  else void makeBotPrimary(bot.id)
                }}
                accessibilityRole="button"
                style={({ pressed }) => ({ minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.border, opacity: bot.isPrimary && !canChangePrimary ? 0.45 : pressed ? 0.65 : 1 })}
              >
                <AppText variant="meta" numberOfLines={1} style={{ fontFamily: 'Inter_500Medium' }}>
                  {bot.isPrimary ? 'Change' : 'Make primary'}
                </AppText>
              </Pressable>
            </View>
          </SectionGroup>

          {keptNotice ? (
            <AppText variant="meta" color={theme.success} style={{ paddingHorizontal: 4 }}>
              {keptNotice}
            </AppText>
          ) : null}

          <SetupForm
            key={`${detail.id}:${detail.name}:${modelKey(detail.model)}:${detail.reasoningEffort}`}
            initial={{ name: detail.name, function: detail.function, instructions: detail.instructions, model: detail.model, reasoningEffort: detail.reasoningEffort }}
            sentEffort={detail.effectiveReasoningEffort}
            providers={providers}
            onSubmit={async values => {
              const socket = ensureSocket()
              if (!socket) throw new Error('Not connected.')
              setKeptNotice('')
              const input = {
                botId: bot.id,
                name: values.name,
                function: values.function,
                instructions: values.instructions,
                reasoningEffort: values.reasoningEffort,
                ...(values.model ? { model: values.model } : {})
              }
              const updated = await socket.call('bots.update', input).catch(async failure => {
                if (!(failure instanceof LilBotError && failure.code === 'confirm_required')) throw failure
                setKeptNotice(failure.message)
                return socket.call('bots.get', { botId: bot.id })
              })
              setLoaded(updated)
              upsert(updated)
            }}
          />

          <SectionGroup title="Workspace" footer="This bot’s own folder. New sessions work here.">
            <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
              <AppText style={{ fontFamily: MONO_FONT, fontSize: 12, lineHeight: 18 }} selectable>
                {detail.workspace}
              </AppText>
            </View>
          </SectionGroup>

          <SkillsSection botId={bot.id} botName={detail.name} />

          <AbilitiesCard abilities={detail.abilities} />
        </>
      ) : null}
    </ScrollView>
  )
}

function AbilitiesCard({ abilities }: { abilities: Ability[] }) {
  const theme = useTheme()
  const rows = ABILITY_KINDS.map(({ kind, label }) => {
    const all = abilities.filter(a => a.kind === kind)
    const enabled = all.filter(a => a.enabled)
    return { kind, label, total: all.length, enabled }
  }).filter(row => row.total > 0)

  if (rows.length === 0) return null
  return (
    <SectionGroup title="Abilities">
      {rows.map((row, index) => (
        <View key={row.kind}>
          {index > 0 ? <RowDivider /> : null}
          <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <AppText variant="name">{row.label}</AppText>
              <AppText variant="meta" color={theme.mutedForeground}>
                {row.enabled.length} of {row.total} on
              </AppText>
            </View>
            <AppText variant="meta" color={theme.mutedForeground}>
              {row.enabled.slice(0, 8).map(a => a.label).join(', ')}
              {row.enabled.length > 8 ? `, and ${row.enabled.length - 8} more` : row.enabled.length === 0 ? 'None enabled' : ''}
            </AppText>
          </View>
        </View>
      ))}
    </SectionGroup>
  )
}
