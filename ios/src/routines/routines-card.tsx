/** Activity tab's Routines card (`R3-05`): each routine with schedule/next state line and ink pause switch. */
import { Fragment, useState } from 'react'
import { Pressable, Switch, View } from 'react-native'
import type { Routine } from '../../../shared/routine-schema'
import { messageOf } from '../../../shared/client/socket'
import { WorkingSpinner } from '../bots/status-marks'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { RoutineDetailSheet } from './routine-detail-sheet'
import { routineLine } from './routine-lines'
import { useRoutines } from './use-routines'

export function RoutinesCard({ botId, botName, now }: { botId: string; botName: string; now: number }) {
  const theme = useTheme()
  const { routines, error, togglePaused, remove } = useRoutines(botId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [failure, setFailure] = useState('')
  const selected = routines?.find(r => r.id === selectedId) ?? null

  const toggle = (routine: Routine, on: boolean) => {
    setFailure('')
    void togglePaused(routine, !on).catch(cause => setFailure(`Could not ${on ? 'resume' : 'pause'} it. ${messageOf(cause)}`))
  }

  return (
    <View style={{ gap: 6 }}>
      <SectionGroup title="Routines" trailing={routines && routines.length > 0 ? String(routines.length) : undefined}>
        {!routines ? (
          <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
            <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground}>
              {error || 'Loading…'}
            </AppText>
          </View>
        ) : routines.length === 0 ? (
          <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
            <AppText variant="preview" color={theme.mutedForeground}>
              Ask {botName} in the chat to add one, for example “check the reviews every morning”.
            </AppText>
          </View>
        ) : (
          routines.map((routine, index) => {
            const line = routineLine(routine, now)
            return (
              <Fragment key={routine.id}>
                {index > 0 ? <RowDivider /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12 }}>
                  <Pressable
                    onPress={() => setSelectedId(routine.id)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({ flex: 1, minWidth: 0, paddingVertical: 11, paddingLeft: 14, gap: 2, opacity: pressed ? 0.65 : 1 })}
                  >
                    <AppText variant="preview" color={line.tone === 'paused' ? theme.mutedForeground : theme.foreground} style={{ fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
                      {routine.description}
                    </AppText>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      {line.tone === 'running' ? <WorkingSpinner color={theme.primary} size={12} /> : null}
                      <AppText variant="meta" color={line.tone === 'failed' ? theme.destructive : theme.mutedForeground} numberOfLines={1} style={{ flex: 1 }}>
                        {line.text}
                      </AppText>
                    </View>
                  </Pressable>
                  <Switch
                    value={!routine.paused}
                    onValueChange={on => toggle(routine, on)}
                    trackColor={{ false: theme.muted, true: theme.foreground }}
                    thumbColor={theme.card}
                    accessibilityLabel={routine.paused ? `Resume ${routine.description}` : `Pause ${routine.description}`}
                  />
                </View>
              </Fragment>
            )
          })
        )}
      </SectionGroup>
      {failure ? (
        <AppText variant="meta" color={theme.destructive} style={{ paddingHorizontal: 4 }}>
          {failure}
        </AppText>
      ) : null}
      <RoutineDetailSheet routine={selected} now={now} onClose={() => setSelectedId(null)} onTogglePaused={togglePaused} onDelete={remove} />
    </View>
  )
}
