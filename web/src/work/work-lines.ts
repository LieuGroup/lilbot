/** Thin web re-export of shared Work board wording and badge rules, bound to web's date formatters. */
import { itemTimestamp as sharedItemTimestamp } from '../../../shared/client/work/work-lines'
import { dayKey, dayLabel, sessionTime } from '../history/history-labels'

const WEB_WORK_LABELS = { dayKey, dayLabel, sessionTime }

export {
  askedByLabel,
  briefSubtitle,
  checkerLabel,
  checkSummaryLine,
  doneBreakdown,
  droppedByLine,
  elapsedShort,
  failedCheckItems,
  isOscarCheck,
  kindLabel,
  kindShortLabel,
  latestSettledCheck,
  levelChoiceLabel,
  levelDescription,
  levelReason,
  type ResultBadge,
  todayHeading,
  workBadge
} from '../../../shared/client/work/work-lines'

export const itemTimestamp = (at: number, now = Date.now()) => sharedItemTimestamp(at, now, WEB_WORK_LABELS)
