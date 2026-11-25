/** Thin web re-export of shared group-lines wording, bound to web's date formatters. */
import { type GroupThread, groupActivityRow as sharedGroupActivityRow, groupSubtitle as sharedGroupSubtitle } from '../../../shared/client/threads/group-lines'
import { dayKey, dayLabel, sessionTime } from '../history/history-labels'

const WEB_DATE_LABELS = { dayKey, dayLabel, sessionTime }

export {
  type GroupThread,
  groupState,
  groupTitle,
  isGroup,
  leaderOf,
  outcomeCard,
  pendingReplies,
  roundLabel,
  shortNames,
  stopSentence
} from '../../../shared/client/threads/group-lines'

export const groupSubtitle = (thread: GroupThread, now: number) => sharedGroupSubtitle(thread, now, WEB_DATE_LABELS)
export const groupActivityRow = (thread: GroupThread, now: number) => sharedGroupActivityRow(thread, now, WEB_DATE_LABELS)
