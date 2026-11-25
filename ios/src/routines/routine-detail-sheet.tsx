/** Routine detail pageSheet: full description, pause/resume switch, Schedule/Next run/Created facts,
 *  recent runs list, and Delete confirmation. */
import { Fragment, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Routine } from '../../../shared/routine-schema'
import { messageOf } from '../../../shared/client/socket'
import { TrashIcon } from '../ui/details-icons'
import { sessionTime } from '../ui/format-time'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { createdRoutineText, runLine, scheduleLabel, whenNext } from './routine-lines'

export function RoutineDetailSheet({
  routine,
  now,
  onClose,
  onTogglePaused,
  onDelete
}: {
  routine: Routine | null
  now: number
  onClose: () => void
  onTogglePaused: (routine: Routine, paused: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [error, setError] = useState('')

  const confirmDelete = () => {
    if (!routine) return
    Alert.alert('Delete this routine?', 'Its schedule stops at once and its past runs are removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void onDelete(routine.id)
            .then(onClose)
            .catch(failure => setError(messageOf(failure)))
        }
      }
    ])
  }

  return (
    <Modal visible={routine !== null} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Math.max(16, insets.top) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <AppText variant="title">Routine</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {routine ? (
              <Pressable onPress={confirmDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete routine" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
                <TrashIcon color={theme.destructive} size={15} />
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
              <CloseIcon color={theme.foreground} size={16} />
            </Pressable>
          </View>
        </View>
        {routine ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: Math.max(32, insets.bottom + 16) }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 2 }}>
              <AppText variant="name" color={routine.paused ? theme.mutedForeground : theme.foreground} style={{ flex: 1, lineHeight: 21 }}>
                {routine.description}
              </AppText>
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
            </View>
            {error ? (
              <AppText variant="meta" color={theme.destructive}>
                {error}
              </AppText>
            ) : null}
            <SectionGroup title="Details">
              <FactRow label="Schedule" value={scheduleLabel(routine.schedule)} />
              <RowDivider />
              <FactRow label="Next run" value={routine.paused ? 'Paused' : whenNext(routine.nextRunAt, now)} />
              <RowDivider />
              <FactRow label="Created" value={createdRoutineText(routine, undefined)} />
            </SectionGroup>
            <SectionGroup title="Runs" trailing={routine.runs.length > 0 ? String(routine.runs.length) : undefined}>
              {routine.runs.length === 0 ? (
                <View style={{ padding: 14 }}>
                  <AppText variant="preview" color={theme.mutedForeground}>
                    No runs yet.
                  </AppText>
                </View>
              ) : (
                routine.runs.slice(0, 15).map((run, index) => (
                  <Fragment key={run.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <View style={{ paddingHorizontal: 14, paddingVertical: 10, gap: 2 }}>
                      <AppText variant="preview" style={{ fontFamily: 'Inter_500Medium' }}>
                        {sessionTime(run.dueAt, now)}
                      </AppText>
                      <AppText variant="meta" color={run.status === 'failed' ? theme.destructive : theme.mutedForeground} numberOfLines={2}>
                        {runLine(run)}
                      </AppText>
                    </View>
                  </Fragment>
                ))
              )}
            </SectionGroup>
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  )
}

function FactRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11, gap: 12 }}>
      <AppText variant="preview" color={theme.mutedForeground}>
        {label}
      </AppText>
      <AppText variant="preview" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </View>
  )
}
