/** Library item viewer pageSheet: displays given images, markdown/text pages, or file actions.
 *  When connected over Cloudflare Access (accessToken set), shares already-fetched text directly instead of
 *  handing an unauthenticated external URL to Safari/Share. */
import { useEffect, useState } from 'react'
import { Image, Linking, Modal, Platform, Pressable, ScrollView, Share, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { LibraryItem } from '../../../shared/library-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket, serverAssetUrl, serverAuthHeadersFor } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { formatBytes } from '../ui/format-time'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { fileName, librarySourceLine, viewOf } from './library-lines'

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' })

export function LibraryViewerSheet({ botId, item, onClose }: { botId: string; item: LibraryItem | null; onClose: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const settings = useConnectionStore(state => state.settings)
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)
  const [textBody, setTextBody] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!item || !settings?.serverUrl) {
      setResolvedUrl(null)
      setTextBody(null)
      setError('')
      return
    }
    if (item.missing) return
    let cancelled = false
    setLoading(true)
    setError('')
    setTextBody(null)
    const socket = ensureSocket()
    const view = viewOf(item)

    const run = async () => {
      try {
        const res = socket ? await socket.call('library.content', { botId, itemId: item.id }) : { url: item.url }
        const fullUrl = serverAssetUrl(res.url)
        if (!fullUrl) throw new Error('Server address rejected.')
        if (cancelled) return
        setResolvedUrl(fullUrl)
        if (view === 'markdown' || view === 'html' || item.mime.startsWith('text/')) {
          const fetched = await fetch(fullUrl, { headers: serverAuthHeadersFor(fullUrl) })
          if (!fetched.ok) throw new Error(`Could not load file (${fetched.status}).`)
          const content = await fetched.text()
          if (!cancelled) setTextBody(content)
        }
      } catch (failure) {
        if (!cancelled) setError(messageOf(failure))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [botId, item, settings?.accessToken, settings?.serverUrl])

  const headers = serverAuthHeadersFor(resolvedUrl)
  const hasAccessToken = Boolean(settings?.accessToken?.trim())
  const view = item ? viewOf(item) : 'download'
  const canExternalOpen = Boolean(resolvedUrl && !item?.missing && !hasAccessToken)
  const canShareText = Boolean(textBody !== null && !item?.missing)

  return (
    <Modal visible={item !== null} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Math.max(16, insets.top) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="title" numberOfLines={1} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle} style={MOBILE_SCALE.details.sheetTitle}>
              {item?.title ?? ''}
            </AppText>
            {item ? (
              <AppText variant="preview" color={theme.mutedForeground} numberOfLines={1} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                {fileName(item.path)} · {formatBytes(item.size)}
              </AppText>
            ) : null}
          </View>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
            <CloseIcon color={theme.foreground} size={16} />
          </Pressable>
        </View>
        {item ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: Math.max(32, insets.bottom + 16) }}>
            {item.missing ? (
              <AppText variant="preview" color={theme.destructive} style={MOBILE_SCALE.details.body}>
                This file is no longer in the bot’s workspace.
              </AppText>
            ) : error ? (
              <AppText variant="preview" color={theme.destructive} style={MOBILE_SCALE.details.body}>
                {error}
              </AppText>
            ) : view === 'image' && resolvedUrl ? (
              <Image source={{ uri: resolvedUrl, headers }} resizeMode="contain" style={{ width: '100%', height: 360, borderRadius: radius.md, backgroundColor: theme.card }} />
            ) : textBody !== null ? (
              <View style={{ borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, padding: 14 }}>
                <AppText style={[view === 'html' ? MOBILE_SCALE.details.code : MOBILE_SCALE.details.body, { fontFamily: view === 'html' ? MONO_FONT : 'Inter_400Regular' }]} selectable>
                  {textBody}
                </AppText>
              </View>
            ) : loading ? (
              <AppText variant="preview" color={theme.mutedForeground} style={MOBILE_SCALE.details.rowSubtitle}>
                Loading…
              </AppText>
            ) : null}
            <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
              {librarySourceLine(item)}
            </AppText>
            {canExternalOpen ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => { if (resolvedUrl) void Linking.openURL(resolvedUrl) }}
                  accessibilityRole="button"
                  style={{ flex: 1, minHeight: 48, borderRadius: radius.md, backgroundColor: theme.foreground, alignItems: 'center', justifyContent: 'center' }}
                >
                  <AppText variant="name" color={theme.background} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
                    Open file
                  </AppText>
                </Pressable>
                <Pressable
                  onPress={() => { if (resolvedUrl) void Share.share({ url: resolvedUrl, title: item.title }) }}
                  accessibilityRole="button"
                  style={{ minHeight: 48, paddingHorizontal: 18, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
                >
                  <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
                    Share
                  </AppText>
                </Pressable>
              </View>
            ) : canShareText ? (
              <Pressable
                onPress={() => { if (textBody !== null) void Share.share({ message: textBody, title: item.title }) }}
                accessibilityRole="button"
                style={{ minHeight: 48, paddingHorizontal: 18, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
              >
                <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
                  Share text
                </AppText>
              </Pressable>
            ) : resolvedUrl && !item.missing && hasAccessToken ? (
              <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                External browser open is unavailable while signed in with an Access token.
              </AppText>
            ) : null}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  )
}
