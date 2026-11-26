/** Shared date and clock formatters for `ios/src/work/` sourced from `shared/client/`. */
import { clockTime, dayKey, dayLabel, sessionTime } from '../../../shared/client/history/history-labels'
import type { WorkDateLabels } from '../../../shared/client/work/work-lines'

export { clockTime }

export const WORK_DATE_LABELS: WorkDateLabels = {
  dayKey,
  dayLabel,
  sessionTime
}
