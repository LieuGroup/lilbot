/** What a webhook run may do on the work board (#12). Its model read outside data, so: it opens at most `RUN_ITEMS`
 *  items and reports only on those; it never gives a check level or links a goal, so its items get their kind's level;
 *  anything it claims at level 2 or above is checked by Oscar, never by a bot, because a checker repeats the owner's
 *  commands and opens its links, which the run wrote; and every bot reads its items' text fenced as outside data
 *  (`fenceRunText`). Its items' answers and notices never resume the run's session (`work-answers.ts`). */
import { LilBotError } from '../../shared/protocol'
import type { WorkInput, WorkOrigin } from '../../shared/work-schema'
import { fenced } from '../memory/memory-safety'
import type { StoredItem, WorkStore } from './work-store'

/** The items one run may open: its own work and a question for Oscar, with one to spare. */
export const RUN_ITEMS = 3
/** An item's fields a webhook run wrote. */
const RUN_TEXT = ['title', 'done', 'question', 'result', 'dropReason', 'evidence'] as const

export const fromWebhook = (origin: WorkOrigin) => origin.kind === 'webhook_run'

/** The level an item a webhook run opens gets: its kind's, with Oscar checking what a bot would. */
export const webhookLevel = (least: number) => (least >= 2 ? 3 : least)

/** Refuses what a webhook run's call may not do: name a level or a goal, open more than `RUN_ITEMS` items, or report on
 *  an item its own run did not open. */
export function webhookRefusal(
  session: WorkOrigin,
  input: Pick<WorkInput, 'level' | 'goalId' | 'itemId' | 'requestId'>,
  store: Pick<WorkStore, 'countFrom' | 'byRequest'>,
  callerId: string,
  item?: Pick<StoredItem, 'origin'>
) {
  if (!fromWebhook(session)) return
  if (input.level !== undefined) throw new LilBotError('work_webhook_level', 'A webhook run does not set check levels: its items get their kind’s level.')
  if (input.goalId !== undefined) throw new LilBotError('work_webhook_goal', 'A webhook run does not work for goals. Open the item without goalId.')
  if (!input.itemId && !item && !store.byRequest(callerId, input.requestId) && store.countFrom(session) >= RUN_ITEMS)
    throw new LilBotError('work_webhook_items', `A webhook run opens at most ${RUN_ITEMS} items. Put the rest in your result.`)
  if (item && !(fromWebhook(item.origin) && item.origin.id === session.id))
    throw new LilBotError('work_webhook_other', 'A webhook run reports only on the items this run opened. Open one for this work.')
}

/** What a bot reads of the board, with the text of every item a webhook run opened fenced as outside data, wherever it
 *  appears (an item, a list, a goal's items, an item's children). */
export function fenceRunText<T>(value: T): T {
  if (Array.isArray(value)) return value.map(fenceRunText) as T
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const out = Object.fromEntries(Object.entries(record).map(([key, field]) => [key, fenceRunText(field)]))
  if ((record.origin as WorkOrigin | undefined)?.kind !== 'webhook_run') return out as T
  for (const key of RUN_TEXT) if (record[key] !== undefined && record[key] !== null && record[key] !== '') out[key] = fenced('webhook-work-item', record[key])
  return out as T
}
