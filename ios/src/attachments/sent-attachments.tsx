/** Sent message attachments above a user bubble (120x150 image tiles with authenticated full-screen
 *  viewer, file chips) and the text-only model ImageNote with "Change model" trigger. */
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Image, Modal, Pressable, View } from 'react-native'
import type { Attachment, ImageSupport } from '../../../shared/attachment-schema'
import { formatBytes, imageNoteText, isImage } from '../../../shared/client/attachments/attachment-rules'
import { serverAssetUrl, serverAuthHeaders } from '../connection/lilbot'
import { FileIcon } from '../ui/chat-icons'
import { CloseIcon, InfoIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { glassFallbackBackground } from '../ui/tokens'

export function SentAttachments({ files }: { files: Attachment[] }) {
  const theme = useTheme()
  const [viewed, setViewed] = useState<{ uri: string; name: string } | null>(null)
  const [reduceTransparency, setReduceTransparency] = useState(false)
  const headers = serverAuthHeaders()
  const images = files.filter(isImage)
  const others = files.filter(file => !isImage(file))

  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceTransparencyEnabled().then(enabled => {
      if (active) setReduceTransparency(enabled)
    })
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency)
    return () => {
      active = false
      sub.remove()
    }
  }, [])

  return (
    <>
      {images.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, maxWidth: '86%' }}>
          {images.map(file => {
            const uri = serverAssetUrl(file.url)
            if (!uri) return null
            return (
              <Pressable
                key={file.id}
                onPress={() => setViewed({ uri, name: file.name })}
                accessibilityRole="button"
                accessibilityLabel={`Open ${file.name}`}
                style={{ width: 120, height: 150, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.muted, borderWidth: 1, borderColor: theme.hairline }}
              >
                <Image source={{ uri, headers }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              </Pressable>
            )
          })}
        </View>
      ) : null}
      {others.map(file => (
        <View
          key={file.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            maxWidth: '86%',
            borderRadius: 12,
            backgroundColor: theme.card,
            borderWidth: 1,
            borderColor: theme.hairline,
            paddingVertical: 8,
            paddingLeft: 8,
            paddingRight: 14
          }}
        >
          <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: theme.muted, alignItems: 'center', justifyContent: 'center' }}>
            <FileIcon color={theme.mutedForeground} size={16} />
          </View>
          <View style={{ flexShrink: 1, gap: 1 }}>
            <AppText variant="preview" numberOfLines={1} color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
              {file.name}
            </AppText>
            <AppText variant="meta" color={theme.mutedForeground}>
              {formatBytes(file.size)}
            </AppText>
          </View>
        </View>
      ))}
      <Modal visible={viewed !== null} transparent animationType="fade" onRequestClose={() => setViewed(null)}>
        <View style={{ flex: 1, backgroundColor: glassFallbackBackground(theme, { reduceTransparency, scrim: true }), justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          {viewed ? <Image source={{ uri: viewed.uri, headers }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
          <Pressable
            onPress={() => setViewed(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close image"
            style={{ position: 'absolute', top: 56, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: theme.glass.scrimSolid, alignItems: 'center', justifyContent: 'center' }}
          >
            <CloseIcon color="#ffffff" size={20} />
          </Pressable>
        </View>
      </Modal>
    </>
  )
}

export function ImageNote({ images, onChangeModel }: { images: ImageSupport | undefined; onChangeModel: () => void }) {
  const theme = useTheme()
  const text = imageNoteText(images)
  if (!text) return null
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, maxWidth: '86%', borderRadius: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, paddingHorizontal: 12, paddingVertical: 10 }}>
      <View style={{ marginTop: 2 }}>
        <InfoIcon color={theme.mutedForeground} size={14} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <AppText variant="preview" color={theme.foreground}>
          {text}
        </AppText>
        <Pressable onPress={onChangeModel} hitSlop={8} accessibilityRole="button">
          <AppText variant="preview" color={theme.foreground} style={{ fontFamily: 'Inter_600SemiBold', textDecorationLine: 'underline' }}>
            Change model
          </AppText>
        </Pressable>
      </View>
    </View>
  )
}
