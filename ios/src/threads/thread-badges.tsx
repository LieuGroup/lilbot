/** Participant avatars, worker/Oscar badges, group avatar stacks, and state lines for threads and the tasks dock. */
import { View } from 'react-native'
import { defaultAvatar } from '../../../shared/avatar'
import type { LineState } from '../../../shared/client/threads/thread-lines'
import { WorkingSpinner } from '../bots/status-marks'
import { useBotStore } from '../bots/store'
import { BotAvatar } from '../ui/avatar'
import { CheckIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { THREAD_TYPE_CAPS } from './dock-pill'
import { WorkerArrowIcon } from './icons'

/** A participant's avatar, looked up in the live roster; deleted bots keep the deterministic default for their id. */
export function ThreadAvatar({ id, name, size = 18 }: { id: string; name: string; size?: number }) {
  const bot = useBotStore(state => state.bots.find(candidate => candidate.id === id))
  return <BotAvatar name={bot?.name ?? name} avatar={bot?.prefs.avatar ?? defaultAvatar(id)} size={size} />
}

/** Muted square mark identifying a same-bot worker (matches web `WorkerBadge`). */
export function WorkerBadge({ size = 20, surface = 'muted' }: { size?: number; surface?: 'muted' | 'card' }) {
  const theme = useTheme()
  const iconSize = Math.max(11, Math.round(size * 0.56))
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.28)),
        backgroundColor: surface === 'card' ? theme.card : theme.muted,
        borderWidth: 1,
        borderColor: theme.hairline,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <WorkerArrowIcon color={theme.mutedForeground} size={iconSize} />
    </View>
  )
}

/** Subtle user mark for Oscar's answer messages inside an exchange or worker transcript. */
export function OscarBadge({ size = 18 }: { size?: number }) {
  const theme = useTheme()
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.muted,
        borderWidth: 1,
        borderColor: theme.hairline,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <AppText variant="meta" maxFontSizeMultiplier={1.1} color={theme.foreground} style={{ fontSize: 10, lineHeight: 12, fontFamily: 'Inter_600SemiBold' }}>
        Y
      </AppText>
    </View>
  )
}

/** Overlapping row of participant avatars for temporary groups. */
export function AvatarStack({ people, size = 20, overlap = 5 }: { people: { id: string; name: string }[]; size?: number; overlap?: number }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {people.map((person, index) => (
        <View
          key={person.id}
          style={{
            marginLeft: index === 0 ? 0 : -overlap,
            borderRadius: size / 2 + 1,
            borderWidth: 1.5,
            borderColor: theme.card
          }}
        >
          <ThreadAvatar id={person.id} name={person.name} size={size} />
        </View>
      ))}
    </View>
  )
}

/** Status icon matching web `StatusIcon`: blue spinner, blue waiting dot, green check, or red cross. */
export function ThreadStatusIcon({ tone, size = 13 }: { tone: LineState['icon']; size?: number }) {
  const theme = useTheme()
  if (!tone) return null
  if (tone === 'working') return <WorkingSpinner color={theme.primary} size={size} />
  if (tone === 'waiting') return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />
  if (tone === 'finished') return <CheckIcon color={theme.success} size={size} />
  return <CloseIcon color={theme.destructive} size={size} />
}

/** Compact state line with its icon; wraps cleanly when `numberOfLines` is lifted at AX text sizes. */
export function StateText({ state, strong = false, numberOfLines = 1 }: { state: LineState; strong?: boolean; numberOfLines?: number }) {
  const theme = useTheme()
  const color = state.failed ? theme.destructive : strong ? theme.foreground : theme.mutedForeground
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }}>
      {state.icon ? <ThreadStatusIcon tone={state.icon} size={12} /> : null}
      <AppText variant="preview" color={color} numberOfLines={numberOfLines} maxFontSizeMultiplier={THREAD_TYPE_CAPS.rowState} style={{ flexShrink: 1 }}>
        {state.text}
      </AppText>
    </View>
  )
}
