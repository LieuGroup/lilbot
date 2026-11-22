/** Why an exchange failed (#170): fixed words chosen from what LilBot knows (which step failed, whose bot is gone), never an
 *  exception's text, a run's output or anything a bot wrote, so they hold no secret and read the same from both sides. */
import type { LilBotError } from '../../shared/lilbot-error'
import type { BotThread } from '../../shared/thread-schema'
import { THREAD_LIMITS } from './thread-limits'
import { type Delivery, isWork, type ThreadStore } from './thread-store'
import type { ThreadWaits } from './thread-waits'

const REMOTE_FAILURE: Record<string, string> = {
  offline: 'the computer went offline',
  interrupted: 'the remote worker was interrupted',
  prompt_too_large: 'the starting prompt exceeded the remote worker limit',
  computer_removed: 'the computer was removed',
  invalid_start: 'the remote worker start request was invalid'
}

/** The receiver's turn ended badly; with an unknown engine receipt LilBot cannot say how, and never ran it again. */
export const turnFailure = (result: { unknownReceipt?: true; failureReason?: string }) =>
  (result.failureReason && REMOTE_FAILURE[result.failureReason]) || (result.unknownReceipt ? 'LilBot could not confirm how the turn ended' : 'the turn ended in an error')

async function reasonFor(host: { requireBot(id: string): Promise<unknown> }, thread: BotThread, d: Delivery, error: LilBotError) {
  if (error.code === 'bot_not_found') {
    const receiver = thread.participants[1]
    const receiverGone = await host.requireBot(receiver.id).then(
      () => false,
      () => true
    )
    return receiverGone ? 'the receiving bot is no longer available' : 'the bot that handed it over is no longer available'
  }
  if (error.code === 'thread_limit') return 'the message limit was reached'
  const noun = isWork(d.kind) ? 'request' : 'answer'
  return d.text.length > THREAD_LIMITS.text ? `the ${noun} was too long to deliver` : `LilBot's safety check withheld the ${noun}`
}

/** A delivery LilBot can never make (a bot gone, a message refused): its exchange fails with the reason and what waits on it
 *  is released. A stopped exchange stays stopped: a late notice that cannot be delivered does not turn the stop into a failure. */
export async function failExchange(store: ThreadStore, waits: ThreadWaits, host: { requireBot(id: string): Promise<unknown> }, d: Delivery, error: LilBotError) {
  const failure = await reasonFor(host, store.get(d.threadId), d, error)
  store.db.transaction(() => {
    const thread = store.get(d.threadId)
    if (thread.status !== 'cancelled') {
      Object.assign(thread, { state: 'failed', status: 'failed', endedAt: Date.now(), failure })
      store.save(thread)
    }
    store.setStatus(d.id, 'done')
    waits.settle(thread.id, null)
  })()
}
