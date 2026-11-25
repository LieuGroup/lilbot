/** Temporary bridge to helpers currently in `web/src/` that PR #299 moves into `shared/client/`.
 *  Re-point these two imports to `~shared/client/` once PR #299 merges into `main`. */
import { clockTime, dayKey, dayLabel, sessionTime } from '../../../web/src/history/history-labels'

export { formatBytes } from '../../../web/src/attachments/attachment-rules'
export { clockTime, sessionTime }

export const THREAD_DATE_LABELS = { dayKey, dayLabel, sessionTime }
