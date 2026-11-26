/** Who checks a finished item, and where the item goes once a check settles. Pure: no database, no engine. */
import type { BotModel } from '../../shared/bot-schema'
import type { WorkCheck } from '../../shared/work-check-schema'
import type { WorkStatus } from '../../shared/work-schema'

type Bot = { id: string; name: string }
export const OSCAR = { kind: 'oscar', id: null, name: 'the owner' } as const
/** The question a level 3 item asks Oscar. */
export const OSCAR_QUESTION = 'Check the result and its evidence, then pass it or send it back.'

/** The model a same-bot check runs on: the configured one when it differs from the owner's, else null (the owner's own). */
export const differentModel = (own: BotModel | null, configured: BotModel | null): BotModel | null =>
  configured && (!own || own.provider !== configured.provider || own.model !== configured.model) ? configured : null

/** LilBot's note on a check no other bot could take, saying which model the owner's fresh session checks on. */
export const sameBotNote = (model: BotModel | null) =>
  `No other bot was eligible, so a fresh session of the bot that did the work checks this, ${model ? `on ${model.provider}::${model.model}` : 'on its own model: no different review model is configured'}.`

/** How a check's bot is named in what Oscar and the owner read. */
export const checkerLabel = (check: Pick<WorkCheck, 'by' | 'sameBot'>) => (check.sameBot ? `${check.by.name} (a fresh session of the same bot)` : check.by.name)

/** The owner and every bot working under the item, at any depth: none of them may check it. */
export function underItem(item: { id: string; ownerId: string }, children: (id: string) => { id: string; ownerId: string }[]) {
  const bots = new Set([item.ownerId])
  const seen = new Set([item.id])
  const queue = [item.id]
  for (let id = queue.pop(); id !== undefined; id = queue.pop())
    for (const child of children(id))
      if (!seen.has(child.id)) {
        seen.add(child.id)
        bots.add(child.ownerId)
        queue.push(child.id)
      }
  return bots
}

/** The bot LilBot asks to check an item, never one in `excluded`: first one that has not checked this item yet, then the
 *  one given the fewest checks so far, then by id. Null when no other bot can check it. */
export function chooseChecker(candidates: Bot[], excluded: Set<string>, checkedThis: Set<string>, load: Map<string, number>): Bot | null {
  const rank = (bot: Bot) => (checkedThis.has(bot.id) ? 1_000_000 : 0) + (load.get(bot.id) ?? 0)
  const eligible = candidates.filter(bot => !excluded.has(bot.id)).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
  return eligible[0] ? { id: eligible[0].id, name: eligible[0].name } : null
}

/** Where an item goes once its check settles: done when verified or passed; back to its owner after its first failed
 *  check or when Oscar sends it back; to Oscar after a second failure or when the check could not be done. */
export function afterCheck(state: WorkCheck['state'], failures: number, checker: string): { status: WorkStatus; question?: string; toOwner?: true } {
  if (state === 'verified' || state === 'passed') return { status: 'done' }
  if (state === 'sent_back' || (state === 'not_verified' && failures < 2)) return { status: 'working', toOwner: true }
  if (state === 'not_verified') return { status: 'needs_oscar', question: `Two checks did not verify this, the last by ${checker}. Pass it anyway or send it back.` }
  return { status: 'needs_oscar', question: `${checker} could not check this. Look at the evidence: pass it or send it back.` }
}
