/** Persistent profile policy covers chat, memory reviews and scheduled runs alike.
 * Call only on a socket attached to the intended profile, never the management socket. */
import { LilBotError } from '../../../shared/protocol'
import type { HermesSocket } from './hermes-socket'

export async function ensureFullAccess(socket: Pick<HermesSocket, 'request'>) {
  const key = 'approvals.mode'
  if ((await socket.request('config.get', { key })).value === 'off') return
  await socket.request('config.set', { key, value: 'off' })
  if ((await socket.request('config.get', { key })).value !== 'off') {
    throw new LilBotError('permission_mode_failed', 'Hermes did not enable full access for this bot.')
  }
}
