/** Evidence entries on a work item page (mirrors `web/src/work/evidence-card.tsx`) on MOBILE_SCALE.work:
 *  command + output, safe http(s) link, sourced number, and read-only Library file pointer (inline Library viewer deferred). */
import { Fragment, useState } from 'react'
import { Linking, Pressable, ScrollView, View } from 'react-native'
import { itemTimestamp, safeHttpUrl } from '../../../shared/client/work/work-lines'
import type { Evidence } from '../../../shared/work-schema'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { WORK_TYPE_CAPS } from './board-state'
import { WORK_DATE_LABELS } from './format-labels'
import { ExternalLinkIcon, FileDocIcon } from './icons'

export function EvidenceCard({ entries, now }: { entries: Evidence[]; now: number }) {
  const theme = useTheme()
  const [error, setError] = useState('')

  const openUrl = async (href: string) => {
    setError('')
    try {
      await Linking.openURL(href)
    } catch {
      setError('Could not open that link.')
    }
  }

  return (
    <View style={{ gap: 6 }}>
      {error ? (
        <AppText color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>
          {error}
        </AppText>
      ) : null}
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, overflow: 'hidden' }}>
        {entries.map((entry, index) => (
          <Fragment key={entry.id}>
            {index > 0 ? <View style={{ height: 1, backgroundColor: theme.hairline }} /> : null}
            <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 6 }}>
              <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.body}>
                {entry.proves}
              </AppText>
              <PointerView entry={entry} now={now} onOpenUrl={href => void openUrl(href)} />
            </View>
          </Fragment>
        ))}
      </View>
    </View>
  )
}

function PointerView({ entry, now, onOpenUrl }: { entry: Evidence; now: number; onOpenUrl: (href: string) => void }) {
  const theme = useTheme()
  const { pointer } = entry

  switch (pointer.kind) {
    case 'library':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.md, backgroundColor: theme.background, paddingHorizontal: 12, paddingVertical: 10 }}>
          <FileDocIcon color={theme.mutedForeground} size={17} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <AppText color={theme.foreground} numberOfLines={2} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.rowTitle, { fontFamily: 'Inter_500Medium' }]}>
              {pointer.title}
            </AppText>
            <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>
              Library file · open on web
            </AppText>
          </View>
        </View>
      )
    case 'command':
      return (
        <View style={{ gap: 4 }}>
          <ScrollView horizontal style={{ borderRadius: radius.md, backgroundColor: theme.background, flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}>
            <AppText color={theme.foreground} selectable maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={[MOBILE_SCALE.work.code, { fontFamily: 'Menlo' }]}>
              {`$ ${pointer.command}${pointer.output ? `\n${pointer.output}` : ''}`}
            </AppText>
          </ScrollView>
          <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>
            {itemTimestamp(entry.at, now, WORK_DATE_LABELS)}
          </AppText>
        </View>
      )
    case 'link': {
      const href = safeHttpUrl(pointer.url)
      if (!href) {
        return (
          <AppText color={theme.mutedForeground} selectable maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>
            {pointer.url}
          </AppText>
        )
      }
      return (
        <Pressable
          onPress={() => onOpenUrl(href)}
          accessibilityRole="link"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingVertical: 4, opacity: pressed ? 0.65 : 1 })}
        >
          <AppText
            color={theme.foreground}
            numberOfLines={2}
            maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle}
            style={[MOBILE_SCALE.work.rowTitle, { flex: 1, fontFamily: 'Inter_500Medium', textDecorationLine: 'underline' }]}
          >
            {pointer.url}
          </AppText>
          <ExternalLinkIcon color={theme.mutedForeground} size={15} />
        </Pressable>
      )
    }
    case 'number':
      return (
        <View style={{ borderRadius: radius.md, backgroundColor: theme.background, paddingHorizontal: 12, paddingVertical: 10, gap: 2 }}>
          <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.cardTitle} style={[MOBILE_SCALE.work.cardTitle, { fontFamily: 'Inter_600SemiBold' }]}>
            {pointer.value}
          </AppText>
          <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>
            Read from {pointer.source} · {itemTimestamp(pointer.readAt, now, WORK_DATE_LABELS)}
          </AppText>
        </View>
      )
  }
}
