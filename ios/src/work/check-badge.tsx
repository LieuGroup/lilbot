/** Check result badge matching `web/src/work/check-badge.tsx` 1:1 (Paper artboard 20, frame 2).
 *  Green appears only for work verified by another bot/fresh checker or passed by Oscar. */
import { View } from 'react-native'
import { type ResultBadge, workBadge } from '../../../shared/client/work/work-lines'
import type { WorkSummary } from '../../../shared/work-schema'
import { WorkingSpinner } from '../bots/status-marks'
import { CheckIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { WORK_TYPE_CAPS } from './board-state'

export function CheckBadge({ item, kind }: { item?: Pick<WorkSummary, 'status' | 'checkLevel' | 'check'>; kind?: ResultBadge | null }) {
  const theme = useTheme()
  const badge = kind !== undefined ? kind : item ? workBadge(item) : null
  if (!badge) return null

  const pill = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 8
  }

  switch (badge) {
    case 'verified':
      return (
        <View style={[pill, { backgroundColor: `${theme.success}1F`, paddingLeft: 6 }]}>
          <CheckIcon color={theme.success} size={12} />
          <AppText variant="meta" color={theme.success} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={{ fontFamily: 'Inter_500Medium' }}>
            Verified
          </AppText>
        </View>
      )
    case 'not_verified':
      return (
        <View style={[pill, { backgroundColor: `${theme.destructive}1A`, paddingLeft: 6 }]}>
          <CloseIcon color={theme.destructive} size={11} />
          <AppText variant="meta" color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={{ fontFamily: 'Inter_500Medium' }}>
            Not verified
          </AppText>
        </View>
      )
    case 'could_not_check':
      return (
        <View style={[pill, { borderWidth: 1, borderColor: `${theme.destructive}66` }]}>
          <AppText variant="meta" color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={{ fontFamily: 'Inter_500Medium' }}>
            Could not check
          </AppText>
        </View>
      )
    case 'self_checked':
      return (
        <View style={[pill, { backgroundColor: theme.muted }]}>
          <AppText variant="meta" color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={{ fontFamily: 'Inter_500Medium' }}>
            Self-checked
          </AppText>
        </View>
      )
    case 'not_checked':
      return (
        <View style={[pill, { backgroundColor: theme.muted }]}>
          <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={{ fontFamily: 'Inter_500Medium' }}>
            Not checked
          </AppText>
        </View>
      )
    case 'checking':
      return (
        <View style={[pill, { backgroundColor: `${theme.primary}1F`, paddingLeft: 6 }]}>
          <WorkingSpinner color={theme.primary} size={11} />
          <AppText variant="meta" color={theme.primary} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={{ fontFamily: 'Inter_500Medium' }}>
            Being checked
          </AppText>
        </View>
      )
  }
}
