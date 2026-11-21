/** The rules every report on a work item passes, whoever makes it. Pure: no database, no engine. */
import { LilBotError } from '../../shared/protocol'
import { KIND_NAMES, type WorkKind } from '../../shared/work-check-schema'
import { type EvidenceInput, type EvidencePointer, FINAL_WORK, type WorkStatus } from '../../shared/work-schema'
import { memoryRefusal } from '../memory/memory-safety'
import type { ItemChange, StoredItem } from './work-store'

export const isFinal = (status: WorkStatus) => FINAL_WORK.includes(status)

/** Work text is shown to Oscar and read by other bots: the memory checks apply (no secrets, hidden characters or
 *  instructions to a model). */
export function refuseUnsafe(texts: (string | undefined)[]) {
  for (const text of texts) {
    const refusal = text && memoryRefusal(text)
    if (refusal) throw new LilBotError('unsafe_text', refusal.replace('Save plain facts about the user or the work', 'Describe the work in plain words'))
  }
}
export const evidenceTexts = (e: EvidenceInput) => [e.proves, e.url, e.command, e.output, e.value, e.source]

/** Exactly one real thing per entry: a Library item, a link, a command with its output, or a number with its source. */
export function pointerOf(e: EvidenceInput, libraryTitle: (itemId: string) => string | null, now: number): EvidencePointer {
  const kinds = [e.library, e.url, e.command, e.value].filter(value => value !== undefined)
  if (kinds.length !== 1) throw new LilBotError('work_evidence', 'Give each evidence entry exactly one of: library, url, command (with output), value (with source).')
  if (e.library !== undefined) {
    const title = libraryTitle(e.library)
    if (!title) throw new LilBotError('work_evidence', 'That Library item is not yours or does not exist. Give the file to the Library first (lilbot_give_file).')
    return { kind: 'library', itemId: e.library, title }
  }
  if (e.url !== undefined) return { kind: 'link', url: e.url }
  if (e.command !== undefined) {
    if (e.output === undefined) throw new LilBotError('work_evidence', 'A command needs the output you read from it.')
    return { kind: 'command', command: e.command, output: e.output }
  }
  if (!e.source) throw new LilBotError('work_evidence', 'A number needs the source you read it from.')
  const readAt = e.readAt ? Date.parse(e.readAt) : now
  if (Number.isNaN(readAt)) throw new LilBotError('work_evidence', 'readAt must be an ISO time, such as 2026-11-20T09:30:00Z.')
  return { kind: 'number', value: e.value!, source: e.source, readAt }
}

export interface Move {
  status: WorkStatus
  question?: string
  result?: string
  reason?: string
}

/** What changes when `item` moves to `move.status`, after any new definition and evidence in the same report.
 *  Refuses a move the board does not allow. */
export function transition(item: StoredItem, move: Move, done: string, evidenceCount: number, now: number): ItemChange {
  const checked = item.checkLevel > 0
  const { status } = move
  if (status === 'open') throw new LilBotError('work_status', 'An item cannot go back to open.')
  if ((status === 'working' || status === 'done') && !item.kind) throw new LilBotError('work_no_kind', `Say what kind of work this is first (kind: ${KINDS}).`)
  if ((status === 'working' || status === 'done') && checked && !done)
    throw new LilBotError('work_no_definition', 'Write the "done" definition (done) first: how you and Oscar will know this is done.')
  if (status === 'done' && checked && evidenceCount === 0)
    throw new LilBotError('work_no_evidence', 'An item is done only with evidence of the real result: read it and add an evidence entry first.')
  if ((status === 'done' || status === 'failed') && !move.result) throw new LilBotError('work_no_result', `Say what came of it (result) when the item is ${status}.`)
  if (status === 'needs_oscar' && !move.question) throw new LilBotError('work_no_question', 'Ask Oscar exactly one question (question).')
  if (status === 'needs_oscar' && item.status === 'needs_oscar') throw new LilBotError('work_asked', 'Oscar has not answered the question already asked. One question at a time.')
  if (status === 'dropped' && !move.reason) throw new LilBotError('work_no_reason', 'Say why the item is dropped (reason). Nothing is deleted.')
  const change: ItemChange = { status }
  if (status === 'working' && item.startedAt === null) change.startedAt = now
  if (status === 'needs_oscar') change.question = move.question
  if (move.result && (status === 'done' || status === 'failed')) change.result = move.result
  if (status === 'dropped') change.dropReason = move.reason
  if (isFinal(status)) change.finishedAt = now
  return change
}

const KINDS = KIND_NAMES.join(', ')
export const belowDefault = (kind: WorkKind, least: number) =>
  new LilBotError('work_level', `A ${kind} item is checked at level ${least} or higher (the kind's default for you); give a level of at least ${least}.`)
export const noKind = () => new LilBotError('work_no_kind', `Say what kind of work this is (kind: ${KINDS}).`)

/** The kind and level a report sets. A kind is given once: at opening, or later on an item LilBot opened without one. The
 *  level starts at the kind's default for the bot (`least`) and may be raised, never lowered. */
export function levelChange(item: Pick<StoredItem, 'kind' | 'checkLevel'>, input: { kind?: WorkKind; level?: number }, least: (kind: WorkKind) => number): ItemChange {
  if (input.kind && item.kind && input.kind !== item.kind) throw new LilBotError('work_kind', 'The kind of work is set once. Open a new item for other work.')
  if (input.level !== undefined && input.level < item.checkLevel) throw new LilBotError('work_level', 'The check level can be raised, never lowered.')
  const change: ItemChange = {}
  let level = Math.max(item.checkLevel, input.level ?? 0)
  if (input.kind && !item.kind) {
    const base = least(input.kind)
    if (input.level !== undefined && input.level < base) throw belowDefault(input.kind, base)
    Object.assign(change, { kind: input.kind, defaultLevel: base })
    level = Math.max(level, base)
  }
  if (level !== item.checkLevel) change.checkLevel = level
  return change
}

/** The first line of a task, short enough for a title. */
export function titleOf(task: string) {
  const line = task.trim().split('\n', 1)[0]
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line
}
