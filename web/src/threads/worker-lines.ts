/** Thin web re-export of shared worker-lines wording, bound to web's clock and date formatters. */
import { inlineState as sharedInlineState, workerActivityRow as sharedWorkerActivityRow } from '../../../shared/client/threads/worker-lines'
import type { BotThread } from '../../../shared/thread-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { clockTime, dayKey, dayLabel, sessionTime } from '../history/history-labels'

const WEB_DATE_LABELS = { dayKey, dayLabel, sessionTime }

export { isOpenOscarCheck, workerFooter, workerSubtitle } from '../../../shared/client/threads/worker-lines'

export const inlineState = (thread: BotThread, waiting?: WorkSummary) => sharedInlineState(thread, clockTime, waiting)
export const workerActivityRow = (thread: BotThread, now: number, waiting?: WorkSummary) => sharedWorkerActivityRow(thread, now, WEB_DATE_LABELS, waiting)
