/** What an engine is given for each service a bot added: LilBot's forwarding route with the bot's own key, never the
 *  service's address or token. Engines keep a server's tool list until its settings change, so the URL names the
 *  sign-in it uses (a new sign-in, or none, reconnects that one server); a token refresh or a passing outage changes nothing. */
import type { McpConnection } from '../engines/mcp-connection'
import { connectionKey } from './connection-keys'
import { ENGINE_PREFIX } from './mcp-address'
import type { McpConnections } from './mcp-connections'

export const SERVICE_PATH = /^\/engine\/connections\/([0-9a-f-]{36})\/mcp$/
export const STATUS_TOOL = 'connection_status'
/** Seconds one tool call may take; LilBot's route stops waiting for the service at the same time. */
export const SERVICE_TIMEOUT_SECONDS = 120

/** One key per bot and service: a key for one service is useless on another, and anywhere but LilBot's loopback. */
export const serviceKeyPurpose = (connectionId: string) => `mcp-service:${connectionId}`

const version = (services: McpConnections, id: string) => (services.usable(id) ? String(services.signedInAt(id) ?? 'open') : 'signed-out')

export function serviceConnections(services: McpConnections, lilbotUrl: string, engineToken: string, botId: string): McpConnection[] {
  return services.list().map(service => {
    const usable = services.usable(service.id)
    return {
      name: `${ENGINE_PREFIX}${service.name}`,
      url: `${lilbotUrl}/engine/connections/${service.id}/mcp?v=${version(services, service.id)}`,
      bearerToken: connectionKey(engineToken, serviceKeyPurpose(service.id), botId),
      timeoutSeconds: SERVICE_TIMEOUT_SECONDS,
      tools: usable ? (services.get(service.id)?.toolNames ?? []) : [STATUS_TOOL],
      optional: true
    }
  })
}

/** Changes exactly when what engines are given changes. */
export const engineGeneration = (services: McpConnections) =>
  JSON.stringify(services.list().map(service => [service.id, service.name, version(services, service.id), services.get(service.id)?.toolNames]))
