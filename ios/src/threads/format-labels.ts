/** Shared date and byte formatters for `ios/src/threads/` sourced from `shared/client/`. */
import { formatBytes } from '../../../shared/client/attachments/attachment-rules'
import { clockTime, dayKey, dayLabel, sessionTime } from '../../../shared/client/history/history-labels'
import type { DateLabels } from '../../../shared/client/threads/thread-lines'

export { clockTime, formatBytes, sessionTime }

export const THREAD_DATE_LABELS: DateLabels = {
  dayKey,
  dayLabel,
  sessionTime
}
