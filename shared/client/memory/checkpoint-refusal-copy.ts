/** Shared plain-language copy for the pre-compress memory-save refusal card (Web and iOS). */
import type { MemoryCheckpointRefusal } from '../../memory-schema'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

const dayKey = (d: Date) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate()

function clockTime(d: Date): string {
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const suffix = h >= 12 ? 'pm' : 'am'
  return `${h % 12 || 12}:${m} ${suffix}`
}

/** Formats roughly when the refused part is from without ever quoting its text. */
export function formatRefusalWhen(pieceAt: number | null, messagesBack: number | null, now = Date.now()): string | null {
  if (pieceAt !== null && Number.isFinite(pieceAt)) {
    const at = new Date(pieceAt)
    const today = new Date(now)
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
    const time = clockTime(at)
    if (dayKey(at) === dayKey(today)) return `from around ${time}`
    if (dayKey(at) === dayKey(yesterday)) return `from yesterday around ${time}`
    const date = `${at.getDate()} ${MONTHS[at.getMonth()]}`
    return at.getFullYear() === today.getFullYear() ? `from ${date} around ${time}` : `from ${date} ${at.getFullYear()} around ${time}`
  }
  if (messagesBack !== null && Number.isFinite(messagesBack) && messagesBack >= 1) {
    if (messagesBack <= 3) return 'from near the end of this conversation'
    const approx = messagesBack >= 15 ? Math.round(messagesBack / 5) * 5 : messagesBack
    return `from about ${approx} messages back`
  }
  return null
}

export const CHECKPOINT_CARD_STATUS = 'Waiting for you'
export const CHECKPOINT_KEEP_GOING_LABEL = 'Compact & continue'
export const CHECKPOINT_NEW_SESSION_LABEL = 'Start a new session'

export function checkpointRefusalTitle(singleMessage: boolean): string {
  return singleMessage ? 'One message couldn’t be saved to memory' : 'One part couldn’t be saved to memory'
}

export function checkpointRefusalBody(refusal: Pick<MemoryCheckpointRefusal, 'singleMessage' | 'pieceAt' | 'messagesBack' | 'usedTwoModels'>, now = Date.now()): string {
  const when = formatRefusalWhen(refusal.pieceAt, refusal.messagesBack, now)
  const subject = refusal.singleMessage
    ? when
      ? `One message ${when}`
      : 'One earlier message'
    : when
      ? `A stretch of this conversation ${when}`
      : 'A stretch of this conversation'
  const tries = refusal.usedTwoModels ? 'LilBot tried twice, with two different models.' : 'LilBot tried twice.'
  return `${subject} couldn’t be read for memory. ${tries} Everything else is saved, and the full conversation stays in your history.`
}

export function checkpointSettledText(needsResend?: boolean): string {
  return needsResend ? 'Continued without saving one earlier part. Send your message again to continue.' : 'Continued without saving one earlier part.'
}
