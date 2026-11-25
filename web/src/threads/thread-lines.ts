/** Thin web re-export of shared thread-lines wording, bound to web's date formatters. */
import { activityRow as sharedActivityRow } from '../../../shared/client/threads/thread-lines'
import type { BotThread } from '../../../shared/thread-schema'
import { dayKey, dayLabel, sessionTime } from '../history/history-labels'

const WEB_DATE_LABELS = { dayKey, dayLabel, sessionTime }

export {
  activityOrder,
  batchOf,
  batchSummary,
  fileCounts,
  isTask,
  isWorker,
  joined,
  type LineState,
  lineState,
  lineTitle,
  otherName,
  plural,
  running,
  sides,
  stopIndex,
  stripState,
  taskTitle
} from '../../../shared/client/threads/thread-lines'

export const activityRow = (thread: BotThread, botId: string, now: number) => sharedActivityRow(thread, botId, now, WEB_DATE_LABELS)
