/** Routine detail pageSheet: description, pause/resume switch & Delete (hidden on goal-owned review routines),
 *  Schedule/Next run/Created facts, paginated tappable runs opening `RunTranscriptSheet`, and single-send Delete. */
import { useEffect, useRef, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Routine, RoutineRun } from '../../../shared/routine-schema'
import { messageOf } from '../../../shared/client/socket'
import { TrashIcon } from '../ui/details-icons'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { sessionTime } from '../ui/format-time'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { createdRoutineText, runHeader, scheduleLabel, whenNext } from './routine-lines'
import { DetailFactRow, RunListSection } from './run-list-section'
import { type OpenRunTarget, RunTranscriptSheet } from './run-transcript-sheet'

export function RoutineDetailSheet({
  botId,
  routine,
  goal,
  now,
  onClose,
  onTogglePaused,
  onDelete
}: {
  botId: string
  routine: Routine | null
  goal?: string
  now: number
  onClose: () => void
  onTogglePaused: (routine: Routine, paused: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [openRun, setOpenRun] = useState<RoutineRun | null>(null)
  const deletingRef = useRef(false)

  useEffect(() => {
    setError('')
    setOpenRun(null)
    deletingRef.current = false
    setDeleting(false)
  }, [routine?.id])

  const runDelete = async (id: string) => {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    setError('')
    try {
      await onDelete(id)
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  const confirmDelete = () => {
    if (!routine || goal || deletingRef.current) return
    Alert.alert('Delete this routine?', 'Its schedule stops at once and its past runs are removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void runDelete(routine.id) }
    ])
  }

  const transcriptTarget: OpenRunTarget | null =
    routine && openRun
      ? {
          botId,
          runId: openRun.id,
          open: 'routines.openRun',
          title: 'Routine run',
          when: runHeader(openRun, now),
          asked: { label: 'Routine', text: routine.description },
          summary: openRun.result
        }
      : null

  return (
    <Modal visible={routine !== null} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Math.max(16, insets.top) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <AppText variant="title" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle} style={MOBILE_SCALE.details.sheetTitle}>
            Routine
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {routine && !goal ? (
              <Pressable disabled={deleting} onPress={confirmDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete routine" accessibilityState={{ disabled: deleting }} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted, opacity: deleting ? 0.45 : 1 }}>
                <TrashIcon color={theme.destructive} size={16} />
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
              <CloseIcon color={theme.foreground} size={16} />
            </Pressable>
          </View>
        </View>
        {routine ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: Math.max(32, insets.bottom + 16) }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 2 }}>
              <AppText variant="name" color={routine.paused ? theme.mutedForeground : theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowTitle, { flex: 1 }]}>
                {routine.description}
              </AppText>
              {!goal ? (
                <Switch
                  value={!routine.paused}
                  onValueChange={on => {
                    setError('')
                    void onTogglePaused(routine, !on).catch(failure => setError(messageOf(failure)))
                  }}
                  trackColor={{ false: theme.muted, true: theme.foreground }}
                  thumbColor={theme.card}
                  accessibilityLabel={routine.paused ? 'Resume this routine' : 'Pause this routine'}
                />
              ) : null}
            </View>
            {error ? (
              <AppText variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                {error}
              </AppText>
            ) : null}
            <SectionGroup
              title="Details"
              footer={goal ? `It reviews your goal “${goal}”. It runs while the goal is agreed and pauses with it, so it has no switch of its own.` : undefined}
            >
              <DetailFactRow label="Schedule" value={scheduleLabel(routine.schedule)} />
              <RowDivider />
              <DetailFactRow label="Next run" value={routine.paused ? 'Paused' : whenNext(routine.nextRunAt, now)} />
              <RowDivider />
              <DetailFactRow label="Created" value={createdRoutineText(routine, goal)} />
            </SectionGroup>
            <RunListSection resetKey={routine.id} runs={routine.runs} titleOf={run => sessionTime(run.dueAt, now)} onOpen={setOpenRun} />
          </ScrollView>
        ) : null}
        <RunTranscriptSheet target={transcriptTarget} onClose={() => setOpenRun(null)} />
      </View>
    </Modal>
  )
}
