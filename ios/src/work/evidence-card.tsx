/** Evidence entries on a work item page (mirrors `web/src/work/evidence-card.tsx`):
 *  command + output, safe http(s) link, sourced number, and read-only Library file pointer (inline Library viewer deferred). */
import { Fragment, useState } from 'react'
import { Linking, Pressable, ScrollView, View } from 'react-native'
import { itemTimestamp, safeHttpUrl } from '../../../shared/client/work/work-lines'
import type { Evidence } from '../../../shared/work-schema'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
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
        <AppText variant="preview" color={theme.destructive}>
          {error}
        </AppText>
      ) : null}
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, overflow: 'hidden' }}>
        {entries.map((entry, index) => (
          <Fragment key={entry.id}>
            {index > 0 ? <View style={{ height: 1, backgroundColor: theme.hairline }} /> : null}
            <View style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 6 }}>
              <AppText variant="preview" color={theme.foreground}>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, backgroundColor: theme.background, paddingHorizontal: 10, paddingVertical: 8 }}>
          <FileDocIcon color={theme.mutedForeground} size={16} />
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <AppText variant="preview" color={theme.foreground} numberOfLines={2} style={{ fontFamily: 'Inter_500Medium' }}>
              {pointer.title}
            </AppText>
            <AppText variant="meta" color={theme.mutedForeground}>
              Library file · open on web
            </AppText>
          </View>
        </View>
      )
    case 'command':
      return (
        <View style={{ gap: 4 }}>
          <ScrollView horizontal style={{ borderRadius: radius.md, backgroundColor: theme.background }} contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}>
            <AppText
              variant="meta"
              color={theme.foreground}
              selectable
              style={{ fontFamily: 'Menlo', lineHeight: 18 }}
            >
              {`$ ${pointer.command}${pointer.output ? `\n${pointer.output}` : ''}`}
            </AppText>
          </ScrollView>
          <AppText variant="meta" color={theme.mutedForeground}>
            {itemTimestamp(entry.at, now, WORK_DATE_LABELS)}
          </AppText>
        </View>
      )
    case 'link': {
      const href = safeHttpUrl(pointer.url)
      if (!href) {
        return (
          <AppText variant="meta" color={theme.mutedForeground} selectable>
            {pointer.url}
          </AppText>
        )
      }
      return (
        <Pressable
          onPress={() => onOpenUrl(href)}
          accessibilityRole="link"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2, opacity: pressed ? 0.65 : 1 })}
        >
          <AppText variant="preview" color={theme.foreground} numberOfLines={2} style={{ flex: 1, fontFamily: 'Inter_500Medium', textDecorationLine: 'underline' }}>
            {pointer.url}
          </AppText>
          <ExternalLinkIcon color={theme.mutedForeground} size={14} />
        </Pressable>
      )
    }
    case 'number':
      return (
        <View style={{ borderRadius: radius.md, backgroundColor: theme.background, paddingHorizontal: 10, paddingVertical: 8, gap: 2 }}>
          <AppText variant="name" color={theme.foreground} style={{ fontFamily: 'Inter_600SemiBold' }}>
            {pointer.value}
          </AppText>
          <AppText variant="meta" color={theme.mutedForeground}>
            Read from {pointer.source} · {itemTimestamp(pointer.readAt, now, WORK_DATE_LABELS)}
          </AppText>
        </View>
      )
  }
}
