/** What a webhook run may do on the work board (#12). Its model read outside data, so: it reports only on items its own
 *  run opened; it never gives a check level, so its items get their kind's level; and anything it claims at level 2 or
 *  above is checked by Oscar, never by a bot, because a checker repeats the owner's commands and opens its links, which
 *  the run wrote. Its items' answers and notices never resume the run's session (`work-answers.ts`). */
import { LilBotError } from '../../shared/protocol'
import type { WorkInput, WorkOrigin } from '../../shared/work-schema'
import type { StoredItem } from './work-store'

export const fromWebhook = (origin: WorkOrigin) => origin.kind === 'webhook_run'

/** The level an item a webhook run opens gets: its kind's, with Oscar checking what a bot would. */
export const webhookLevel = (least: number) => (least >= 2 ? 3 : least)

/** Refuses what a webhook run's call may not do: name a level, or report on an item its own run did not open. */
export function webhookRefusal(session: WorkOrigin, input: Pick<WorkInput, 'level'>, item?: Pick<StoredItem, 'origin'>) {
  if (!fromWebhook(session)) return
  if (input.level !== undefined) throw new LilBotError('work_webhook_level', 'A webhook run does not set check levels: its items get their kind’s level.')
  if (item && !(fromWebhook(item.origin) && item.origin.id === session.id))
    throw new LilBotError('work_webhook_other', 'A webhook run reports only on the items this run opened. Open one for this work.')
}
