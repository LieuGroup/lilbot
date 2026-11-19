/** Applies app-owned settings without storing LilBot's display name in a Hermes profile. */
import { LilBotError } from '../../../shared/protocol'
import type { EngineBotDetail, RuntimeIdentity } from '../bot-engine'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { runtimePrefix } from './hermes-environment'
import type { HermesSocket } from './hermes-socket'

type Socket = Pick<HermesSocket, 'request'>

export async function createRuntime(socket: Socket, identity: RuntimeIdentity): Promise<string> {
  // A runtime has its own id; the app persists the returned binding.
  const id = `${runtimePrefix()}${crypto.randomUUID()}`
  await socket.request('profiles.create', {
    name: id,
    description: identity.function,
    soul: identity.instructions,
    no_alias: true,
    clone_from: DEFAULT_PROFILE,
    ...(identity.model ? { model: identity.model.model, provider: identity.model.provider } : {})
  })
  return id
}

export async function applyIdentity(socket: Socket, id: string, identity: RuntimeIdentity, current: EngineBotDetail) {
  const changes: Record<string, unknown> = { name: id }
  if (identity.function !== current.function) changes.description = identity.function
  if (identity.instructions !== current.instructions) changes.soul = identity.instructions
  if (identity.model && (identity.model.model !== current.model?.model || identity.model.provider !== current.model?.provider)) {
    Object.assign(changes, { model: identity.model.model, provider: identity.model.provider })
  }
  if (Object.keys(changes).length === 1) return
  const result = await socket.request('profiles.configure', changes)
  if (result.confirm_required) throw new LilBotError('confirm_required', String(result.confirm_message ?? 'Hermes needs a confirmation for this change.'))
  if (result.ok !== true) throw new LilBotError('update_failed', 'Hermes did not apply the change.')
}
