/** Staged attachment tiles/chips and refusal notes inside the iOS composer, plus the Photo/File picker sheet. */
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatBytes, leftOutText, refusalText } from '../../../shared/client/attachments/attachment-rules'
import { FileIcon, ImageIcon } from '../ui/chat-icons'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import type { StagedAttachments, StagedFile } from './use-staged-attachments'

const isWaiting = (file: StagedFile) => file.state === 'preparing' || file.state === 'uploading'

export function ComposerAttachments({ staged }: { staged: StagedAttachments }) {
  const theme = useTheme()
  const kept = staged.files.filter(file => file.state !== 'refused')
  const refused = staged.files.filter(file => file.state === 'refused')
  if (kept.length === 0 && refused.length === 0 && staged.leftOut === 0) return null

  return (
    <View style={{ gap: 8, marginBottom: 8 }}>
      {kept.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 6, paddingRight: 6 }}>
          {kept.map(file => (file.previewUri ? <ImageTile key={file.key} file={file} onRemove={staged.remove} /> : <FileChip key={file.key} file={file} onRemove={staged.remove} />))}
        </ScrollView>
      ) : null}
      {refused.map(file => (
        <View
          key={file.key}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.destructive,
            backgroundColor: theme.background,
            paddingHorizontal: 10,
            paddingVertical: 8
          }}
        >
          <View style={{ flex: 1, gap: 1 }}>
            <AppText variant="preview" numberOfLines={1} color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
              {file.name}
            </AppText>
            <AppText variant="meta" color={theme.destructive}>
              {refusalText({ size: file.size, reason: file.reason }, staged.limits)}
            </AppText>
          </View>
          <Pressable onPress={() => staged.remove(file.key)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${file.name}`}>
            <CloseIcon color={theme.mutedForeground} size={15} />
          </Pressable>
        </View>
      ))}
      {staged.leftOut > 0 && staged.limits ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.destructive,
            backgroundColor: theme.background,
            paddingHorizontal: 10,
            paddingVertical: 8
          }}
        >
          <AppText variant="preview" color={theme.destructive} style={{ flex: 1 }}>
            {leftOutText(staged.leftOut, staged.limits)}
          </AppText>
          <Pressable onPress={staged.dismissLeftOut} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
            <CloseIcon color={theme.mutedForeground} size={15} />
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function ImageTile({ file, onRemove }: { file: StagedFile; onRemove: (key: string) => void }) {
  const theme = useTheme()
  return (
    <View style={{ width: 64, height: 64 }}>
      <View style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.muted, borderWidth: 1, borderColor: theme.hairline, alignItems: 'center', justifyContent: 'center' }}>
        {isWaiting(file) ? <ActivityIndicator size="small" color={theme.primary} /> : <Image source={{ uri: file.previewUri }} style={{ width: 64, height: 64 }} resizeMode="cover" />}
      </View>
      <RemoveBadge name={file.name} onPress={() => onRemove(file.key)} />
    </View>
  )
}

function FileChip({ file, onRemove }: { file: StagedFile; onRemove: (key: string) => void }) {
  const theme = useTheme()
  return (
    <View style={{ height: 64, maxWidth: 220, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: theme.background, borderWidth: 1, borderColor: theme.hairline, paddingLeft: 10, paddingRight: 14 }}>
      <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }}>
        {isWaiting(file) ? <ActivityIndicator size="small" color={theme.primary} /> : <FileIcon color={theme.mutedForeground} size={16} />}
      </View>
      <View style={{ flexShrink: 1, gap: 1 }}>
        <AppText variant="preview" numberOfLines={1} color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
          {file.name}
        </AppText>
        <AppText variant="meta" color={theme.mutedForeground}>
          {file.state === 'uploading' ? 'Uploading...' : formatBytes(file.size)}
        </AppText>
      </View>
      <RemoveBadge name={file.name} onPress={() => onRemove(file.key)} />
    </View>
  )
}

function RemoveBadge({ name, onPress }: { name: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${name}`}
      style={{
        position: 'absolute',
        top: -5,
        right: -5,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: theme.foreground,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <CloseIcon color={theme.card} size={11} />
    </Pressable>
  )
}

interface AttachSourceSheetProps {
  visible: boolean
  onClose: () => void
  onPickPhotos: () => void
  onPickFiles: () => void
}

export function AttachSourceSheet({ visible, onClose, onPickPhotos, onPickFiles }: AttachSourceSheetProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', justifyContent: 'flex-end', paddingTop: 16, paddingBottom: Math.max(16, insets.bottom + 8), paddingLeft: Math.max(16, insets.left + 8), paddingRight: Math.max(16, insets.right + 8) }}>
        <Pressable onPress={event => event.stopPropagation()} style={{ backgroundColor: theme.card, borderRadius: 18, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden' }}>
          <Pressable
            testID="attach-photo-library"
            onPress={() => {
              onClose()
              onPickPhotos()
            }}
            accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 15, backgroundColor: pressed ? theme.muted : theme.card })}
          >
            <ImageIcon color={theme.foreground} size={18} />
            <AppText variant="title" color={theme.foreground}>
              Photo library
            </AppText>
          </Pressable>
          <View style={{ height: 1, backgroundColor: theme.hairline }} />
          <Pressable
            testID="attach-choose-file"
            onPress={() => {
              onClose()
              onPickFiles()
            }}
            accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 15, backgroundColor: pressed ? theme.muted : theme.card })}
          >
            <FileIcon color={theme.foreground} size={18} />
            <AppText variant="title" color={theme.foreground}>
              Choose file
            </AppText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
