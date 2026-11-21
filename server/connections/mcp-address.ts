/** What LilBot accepts as a service address, an OAuth endpoint and a tool name. Every one of them comes from a bot or a
 *  service: untrusted text, checked before it is fetched, stored or given to an engine. */
import { LilBotError } from '../../shared/lilbot-error'
import { memoryRefusal } from '../memory/memory-safety'
import { isBlockedLiteralHost, isLoopbackHost } from './mcp-net'

/** Engine-side server names are `lilbot_c_<name>`: LilBot's own namespace, so a bot's name never meets Oscar's servers. */
export const ENGINE_PREFIX = 'lilbot_c_'
const MAX_TOOLS = 200
const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

export const isLoopback = (url: URL) => isLoopbackHost(url.hostname)

/** HTTPS, or plain HTTP to this machine only; no private/reserved literal IPs, user name, password, fragment or secret. */
export function serviceAddress(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new LilBotError('connection_address', 'That is not a web address.')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url)))
    throw new LilBotError('connection_address', 'The address must start with https:// (plain http only for this machine).')
  if (url.username || url.password || url.hash) throw new LilBotError('connection_address', 'The address may not carry a user name, a password or a #fragment.')
  if (isBlockedLiteralHost(url.hostname, true)) throw new LilBotError('connection_address', 'That address points to a private or reserved network LilBot does not connect to.')
  if (memoryRefusal(url.href)) throw new LilBotError('connection_address', 'The address seems to carry a secret. Give the plain address; LilBot does the sign-in.')
  return url
}

/** An endpoint a service names for its sign-in. A service on the internet may not send LilBot to this machine. */
export function endpointOf(raw: unknown, service: URL): URL {
  if (typeof raw !== 'string') throw new LilBotError('connection_sign_in', 'The service did not describe its sign-in.')
  const url = serviceAddress(raw)
  if (!isLoopback(service) && (url.protocol === 'http:' || isLoopback(url))) throw new LilBotError('connection_sign_in', 'The service names a sign-in address LilBot does not use.')
  return url
}

/** The tool names a service listed that an engine may be given, in order, without repeats, `lilbot_*` spoofing, or cleaned-up collisions. */
export function toolNames(tools: unknown, mapName?: (tool: string) => string): string[] {
  if (!Array.isArray(tools)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const tool of tools) {
    const name = tool && typeof tool === 'object' ? (tool as { name?: unknown }).name : undefined
    if (typeof name !== 'string' || !TOOL_NAME.test(name) || /^lilbot_/i.test(name)) continue
    const key = mapName ? mapName(name) : name.replace(/[^A-Za-z0-9_]/g, '_')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= MAX_TOOLS) break
  }
  return out
}
