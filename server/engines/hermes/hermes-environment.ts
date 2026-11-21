/** A second boundary inside the adapter, in addition to separate gateway state. */
import { LilBotError } from '../../../shared/lilbot-error'

export function allowedProfile(id: string, environment = process.env.LILBOT_ENV): boolean {
  return id.startsWith('dev-') === (environment === 'development')
}
export function requireProfileEnvironment(id: string) {
  if (!allowedProfile(id)) throw new LilBotError('bot_not_found', 'That profile belongs to the other environment.')
}
export function runtimePrefix() {
  return process.env.LILBOT_ENV === 'development' ? 'dev-' : ''
}

/** Refuse an attach receipt from another home before opening its WebSocket. */
export function assertDevAttachment(grant: { endpoint?: { profile_id?: string; control_home?: string | null } }, profile: string) {
  if (process.env.LILBOT_ENV !== 'development') return
  const home = process.env.HERMES_HOME
  const expected = profile && profile !== 'default' ? `${home}/profiles/${profile}` : home
  if (!home || grant.endpoint?.profile_id !== expected || (grant.endpoint?.control_home && grant.endpoint?.control_home !== home)) {
    throw new LilBotError('engine_unavailable', 'Development refused a gateway from another Hermes home.')
  }
}
