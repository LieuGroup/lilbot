/** Read-only workspace browser pageSheet (`library.workspace`): breadcrumb path, folders first, files with byte size.
 *  Working files stay read-only here; only files explicitly handed over by the bot open in Library. */
import { Fragment, useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { WorkspaceEntry } from '../../../shared/library-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { FileTextIcon, FolderIcon } from '../ui/details-icons'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../ui/dynamic-type'
import { formatBytes } from '../ui/format-time'
import { RowDivider } from '../ui/grouped-card'
import { ChevronRightIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { countLine, pathParts } from './library-lines'

export function WorkspaceSheet({ botId, visible, onClose }: { botId: string; visible: boolean; onClose: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { fontScale } = useWindowDimensions()
  const rowLines = rosterRowTextLines(fontScale)
  const connected = useConnectionStore(state => state.connected)
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) {
      setPath('')
      return
    }
    if (!connected) return
    const socket = ensureSocket()
    if (!socket) return
    let active = true
    setEntries(null)
    setError('')
    socket
      .call('library.workspace', { botId, path })
      .then(result => {
        if (active) setEntries(result)
      })
      .catch(failure => {
        if (active) setError(messageOf(failure))
      })
    return () => {
      active = false
    }
  }, [botId, connected, path, visible])

  const parts = pathParts(path)

  return (
    <Modal visible={visible} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Math.max(16, insets.top) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <AppText variant="title" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle} style={MOBILE_SCALE.details.sheetTitle}>
            Workspace
          </AppText>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
            <CloseIcon color={theme.foreground} size={16} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: Math.max(32, insets.bottom + 16) }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
            {parts.map((part, index) => (
              <Fragment key={part.path || 'root'}>
                {index > 0 ? (
                  <AppText variant="preview" color={theme.mutedForeground} style={MOBILE_SCALE.details.rowSubtitle}>
                    /
                  </AppText>
                ) : null}
                {index === parts.length - 1 ? (
                  <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                    {part.name}
                  </AppText>
                ) : (
                  <Pressable onPress={() => setPath(part.path)} hitSlop={6} accessibilityRole="button">
                    <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                      {part.name}
                    </AppText>
                  </Pressable>
                )}
              </Fragment>
            ))}
          </View>

          {!entries ? (
            <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
              {error || 'Loading…'}
            </AppText>
          ) : (
            <>
              {entries.length > 0 ? (
                <View style={{ borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden' }}>
                  {entries.map((entry, index) => (
                    <Fragment key={entry.name}>
                      {index > 0 ? <RowDivider /> : null}
                      {entry.directory ? (
                        <Pressable
                          onPress={() => setPath(path ? `${path}/${entry.name}` : entry.name)}
                          accessibilityRole="button"
                          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, minHeight: 52, opacity: pressed ? 0.65 : 1 })}
                        >
                          <FolderIcon color={theme.mutedForeground} size={17} />
                          <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowTitle, { flex: 1 }]}>
                            {entry.name}
                          </AppText>
                          <ChevronRightIcon color={theme.mutedForeground} size={15} />
                        </Pressable>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, minHeight: 50 }}>
                          <FileTextIcon color={theme.mutedForeground} size={17} />
                          <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowTitle, { flex: 1 }]}>
                            {entry.name}
                          </AppText>
                          <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowTime} style={MOBILE_SCALE.details.meta}>
                            {formatBytes(entry.size)}
                          </AppText>
                        </View>
                      )}
                    </Fragment>
                  ))}
                </View>
              ) : null}
              <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
                {countLine(entries)}
              </AppText>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}
