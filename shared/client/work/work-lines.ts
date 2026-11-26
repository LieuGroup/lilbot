/** Pure wording, badge classification, and formatting for the Work board and Check levels (Paper artboard 20). */
import type { WorkCheck, WorkKind } from '../../work-check-schema'
import type { WorkAsker, WorkItem, WorkSummary } from '../../work-schema'

export type ResultBadge = 'verified' | 'not_verified' | 'could_not_check' | 'self_checked' | 'not_checked' | 'checking'

export interface WorkDateLabels {
  dayKey: (at: number) => number
  dayLabel: (at: number, now?: number) => string
  sessionTime: (at: number, now?: number) => string
}

const KIND_LABELS: Record<WorkKind, { full: string; short: string; reason: string }> = {
  reply: { full: 'Reply', short: 'Reply', reason: 'a reply' },
  note: { full: 'Internal note', short: 'Internal note', reason: 'an internal note' },
  file: { full: 'File or report', short: 'File or report', reason: 'a file or report' },
  computer: { full: 'Change on a computer', short: 'Computer change', reason: 'a change on a computer' },
  code: { full: 'Code change', short: 'Code change', reason: 'a code change' },
  deploy: { full: 'Deploy', short: 'Deploy', reason: 'a deploy' },
  outside: { full: 'Post or message that leaves', short: 'Post or message', reason: 'a post or message that leaves the system' },
  spending: { full: 'Spending', short: 'Spending', reason: 'spending' },
  figure: { full: 'A figure you will decide on', short: 'Figure', reason: 'a figure you will decide on' }
}

const LEVEL_CHOICES: Record<number, { short: string; full: string }> = {
  0: { short: 'No check', full: 'No check' },
  1: { short: 'The bot itself', full: 'The bot reads the real result itself' },
  2: { short: 'A second bot', full: 'A second bot reproduces it' },
  3: { short: 'You', full: 'You check it' }
}

export const kindLabel = (kind: WorkKind) => KIND_LABELS[kind].full
export const kindShortLabel = (kind: WorkKind) => KIND_LABELS[kind].short
export const levelChoiceLabel = (level: number) => LEVEL_CHOICES[level]?.short ?? `Level ${level}`
export const levelDescription = (level: number) => LEVEL_CHOICES[level]?.full ?? `Level ${level}`

/** Frame 2 badge classification: green appears ONLY when another bot (or fresh checker) verified or Oscar passed.
 *  Work that needed a check and has no green mark is never shown as plain done. */
export function workBadge(item: Pick<WorkSummary, 'status' | 'checkLevel' | 'check'>): ResultBadge | null {
  if (item.status === 'checking') return 'checking'
  if (item.status === 'done') {
    if (item.checkLevel >= 2) {
      if (item.check?.state === 'verified' || item.check?.state === 'passed') return 'verified'
      return 'not_verified'
    }
    return item.checkLevel === 1 ? 'self_checked' : 'not_checked'
  }
  if (item.check?.state === 'not_verified') return 'not_verified'
  if (item.check?.state === 'could_not_check') return 'could_not_check'
  return null
}

/** True when an item in `needs_oscar` is waiting for Oscar's check (Level 3 or escalated) rather than an answer. */
export function isOscarCheck(item: Pick<WorkSummary, 'status' | 'check'>): boolean {
  return item.status === 'needs_oscar' && item.check?.by.kind === 'oscar' && item.check.state === 'checking'
}

/** Items for Today's "Checks that failed" section: items that failed or whose latest check was not verified / could not check. */
export function failedCheckItems(items: WorkSummary[], since: number): WorkSummary[] {
  return items.filter(item => {
    if (item.status === 'done' || item.status === 'dropped') return false
    if (item.status === 'failed') return item.updatedAt >= since
    if (item.check?.state === 'not_verified' || item.check?.state === 'could_not_check')
      return item.updatedAt >= since || item.status === 'working' || item.status === 'needs_oscar'
    return false
  })
}

export function doneBreakdown(items: WorkSummary[]) {
  let verified = 0
  let selfChecked = 0
  let notChecked = 0
  for (const item of items) {
    const badge = workBadge(item)
    if (badge === 'verified') verified++
    else if (badge === 'self_checked') selfChecked++
    else notChecked++
  }
  return { verified, selfChecked, notChecked }
}

const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "Friday 20 November" in local time. */
export function todayHeading(now = Date.now()) {
  const date = new Date(now)
  return `${WEEKDAYS_FULL[date.getDay()]} ${date.getDate()} ${MONTHS_FULL[date.getMonth()]}`
}

/** "2 things need you · 1 check failed · 14 done · 3 in progress" */
export function briefSubtitle(counts: { needs: number; failed: number; done: number; working: number }): string {
  const parts: string[] = []
  if (counts.needs > 0) parts.push(counts.needs === 1 ? '1 thing needs you' : `${counts.needs} things need you`)
  if (counts.failed > 0) parts.push(counts.failed === 1 ? '1 check failed' : `${counts.failed} checks failed`)
  if (counts.done > 0) parts.push(`${counts.done} done`)
  if (counts.working > 0) parts.push(`${counts.working} in progress`)
  return parts.length ? parts.join(' · ') : 'All quiet today'
}

/** "40 min", "1 h", "2 d" — compact elapsed time for board rows and cards. */
export function elapsedShort(ms: number, suffix = ''): string {
  const mins = Math.max(1, Math.round(ms / 60_000))
  const text = mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`
  return suffix ? `${text} ${suffix}` : text
}

export function askedByLabel(askedBy: WorkAsker): string {
  const labels = { oscar: 'asked by you', bot: `asked by ${askedBy.name}`, routine: 'by a routine', webhook: 'from a webhook', self: 'started by itself' }
  return labels[askedBy.kind]
}

export function checkerLabel(check: WorkCheck, ownerName: string): string {
  if (check.by.kind === 'oscar') return 'you'
  if (check.sameBot) return `a fresh session of ${ownerName}`
  return check.by.name
}

export function levelReason(item: Pick<WorkItem, 'kind' | 'checkLevel' | 'defaultLevel'>): string {
  if (!item.kind) return 'Opened before work kinds were set.'
  const because = `Because it is ${KIND_LABELS[item.kind].reason}.`
  if (item.defaultLevel === null || item.checkLevel === item.defaultLevel) return `${because} That is your default for this kind of work.`
  return `${because} Raised from Level ${item.defaultLevel} (the default for this kind).`
}

export function checkSummaryLine(item: WorkSummary): string {
  const check = item.check
  if (check?.state === 'not_verified') {
    const by = checkerLabel(check, item.ownerName)
    const detail = check.text ? `: ${check.text}` : '.'
    return `Not verified by ${by}${detail} Sent back to ${item.ownerName}.`
  }
  if (check?.state === 'could_not_check') {
    const by = checkerLabel(check, item.ownerName)
    return `Could not be checked by ${by}${check.text ? `: ${check.text}` : '.'}`
  }
  return `Failed · ${item.ownerName}`
}

export function droppedByLine(item: WorkItem): string {
  const dropEvent = [...item.events].reverse().find(e => e.kind === 'status' && e.status === 'dropped')
  const who = dropEvent?.by === 'oscar' ? 'you' : dropEvent?.by === 'lilbot' ? 'LilBot' : item.ownerName
  return item.dropReason ? `Dropped by ${who} · "${item.dropReason}"` : `Dropped by ${who}`
}

export function itemTimestamp(at: number, now: number, labels: WorkDateLabels) {
  if (labels.dayKey(at) === labels.dayKey(now)) return labels.sessionTime(at, now).replace(/^Today /, 'today ')
  return labels.dayLabel(at, now)
}

/** Latest settled check on an item (ignoring an open `checking` check or a `dropped` check). */
export function latestSettledCheck(checks: WorkCheck[]): WorkCheck | undefined {
  return [...checks].reverse().find(c => c.state !== 'checking' && c.state !== 'dropped')
}

/** Compact status subtitle for an in-chat `WorkLine` card. */
export function workLineStatus(item: Pick<WorkSummary, 'status'>, children: Pick<WorkSummary, 'status'>[]): string {
  const parts = children.length > 0 ? ` · ${children.length} ${children.length === 1 ? 'part' : 'parts'}, ${children.filter(c => c.status === 'done').length} done` : ''
  switch (item.status) {
    case 'open':
      return `Open${parts}`
    case 'working':
      return `Working${parts}`
    case 'checking':
      return 'Being checked'
    case 'needs_oscar':
      return 'Needs you'
    case 'done':
      return `Finished${parts}`
    case 'failed':
      return 'Failed'
    case 'dropped':
      return 'Dropped'
  }
}

/** Accepts only `http:` and `https:` URLs for evidence link pointers. */
export function safeHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}
