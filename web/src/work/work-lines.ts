/** Pure wording, badge classification, grouping and formatting for the Work board and Check levels (Paper artboard 20). */
import type { WorkCheck, WorkKind } from '../../../shared/work-check-schema'
import type { WorkAsker, WorkItem, WorkSummary } from '../../../shared/work-schema'
import { dayKey, dayLabel, sessionTime } from '../history/history-labels'

export type ResultBadge = 'verified' | 'not_verified' | 'could_not_check' | 'self_checked' | 'not_checked' | 'checking'

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
  switch (askedBy.kind) {
    case 'oscar':
      return 'asked by you'
    case 'bot':
      return `asked by ${askedBy.name}`
    case 'routine':
      return 'by a routine'
    case 'webhook':
      return 'from a webhook'
    case 'self':
      return 'started by itself'
  }
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

export function itemTimestamp(at: number, now = Date.now()) {
  if (dayKey(at) === dayKey(now)) return sessionTime(at, now).replace(/^Today /, 'today ')
  return dayLabel(at, now)
}

export interface TreeRow {
  item: WorkSummary
  children: WorkSummary[]
}

/** Nests children whose parent is also in `items` directly under that parent, preserving order. */
export function nestItems(items: WorkSummary[]): TreeRow[] {
  const byId = new Set(items.map(i => i.id))
  const children = new Map<string, WorkSummary[]>()
  const roots: WorkSummary[] = []
  for (const item of items) {
    if (item.parentId && byId.has(item.parentId)) {
      const list = children.get(item.parentId) ?? []
      list.push(item)
      children.set(item.parentId, list)
    } else {
      roots.push(item)
    }
  }
  return roots.map(item => ({ item, children: children.get(item.id) ?? [] }))
}

export function groupByStatus(items: WorkSummary[]) {
  return {
    needsOscar: items.filter(i => i.status === 'needs_oscar'),
    working: nestItems(items.filter(i => i.status === 'open' || i.status === 'working' || i.status === 'checking')),
    done: items.filter(i => i.status === 'done'),
    failed: items.filter(i => i.status === 'failed'),
    dropped: items.filter(i => i.status === 'dropped')
  }
}

export function groupByBot(items: WorkSummary[]) {
  const groups = new Map<string, { botId: string; botName: string; items: WorkSummary[] }>()
  for (const item of items) {
    const group = groups.get(item.ownerId) ?? { botId: item.ownerId, botName: item.ownerName, items: [] }
    group.items.push(item)
    groups.set(item.ownerId, group)
  }
  return [...groups.values()].sort((a, b) => {
    const aNeeds = a.items.filter(i => i.status === 'needs_oscar').length
    const bNeeds = b.items.filter(i => i.status === 'needs_oscar').length
    if (aNeeds !== bNeeds) return bNeeds - aNeeds
    return a.botName.localeCompare(b.botName)
  })
}
