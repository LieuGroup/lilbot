/** Engine-neutral matching between reported tool starts and LilBot-owned or forwarded MCP tools. */

/** The tools that need to know their calling conversation. Engines may prefix the name with the server's. */
export type CallingTool =
  | 'lilbot_delegate'
  | 'lilbot_delegation'
  | 'lilbot_work'
  | 'lilbot_group'
  | 'lilbot_goal'
  | 'lilbot_give_file'
  | 'lilbot_webhook_message'
  | 'lilbot_connection'
  | 'lilbot_show'

export type ToolNamer = (server: string, tool: string) => string
export type ToolName = (botId: string, server: string, tool: string) => string
export type BotNamer = (botId: string) => ToolNamer

export interface CallingToolCatalog {
  namer?: BotNamer
  /** Registered bot-added MCP services (`lilbot_c_<name>`) and their tool names. */
  services?: () => Iterable<{ server: string; tools: readonly string[] }>
  /** Allowed T3 bridge tool names (server `lilbot_t3`). */
  t3Tools?: readonly string[]
}

const SYSTEM_SERVER = 'lilbot_system'
const T3_SERVER = 'lilbot_t3'
const SERVICE_PREFIX = 'lilbot_c_'
const RAW_TOOL = /^[a-z0-9]+(?:_[a-z0-9]+)*$/
const TOOL_PROBE = 'toolprobe'
const SERVER_PROBE = 'srvprobe'

export const defaultNamer: ToolNamer = (server, tool) => `mcp__${server}__${tool}`

export const asRecord = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/** Arguments as text that does not depend on key order, to tell two calls of one tool apart. */
export function argsKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(argsKey).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${argsKey((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

const matchesServerTemplate = (namer: ToolNamer, server: string, tool: string): boolean => {
  const sample = namer(server, TOOL_PROBE)
  if (sample === TOOL_PROBE) return false
  const idx = sample.indexOf(TOOL_PROBE)
  return idx >= 0 && tool.startsWith(sample.slice(0, idx)) && tool.endsWith(sample.slice(idx + TOOL_PROBE.length))
}

/** Matches a prefixed bot-added service name (e.g. `mcp__lilbot_c_<name>__<tool>` or `eng:lilbot_c_<name>:<tool>`) without scanning the catalog. */
const matchesServiceTemplate = (namer: ToolNamer, tool: string): 'matched' | 'unmatched' | 'opaque' => {
  const sample = namer(`${SERVICE_PREFIX}${SERVER_PROBE}`, TOOL_PROBE)
  const serverIdx = sample.indexOf(SERVER_PROBE)
  const toolIdx = sample.indexOf(TOOL_PROBE)
  if (serverIdx < 0 || toolIdx < 0 || toolIdx <= serverIdx) return 'opaque'
  const prefix = sample.slice(0, serverIdx)
  const mid = sample.slice(serverIdx + SERVER_PROBE.length, toolIdx)
  const suffix = sample.slice(toolIdx + TOOL_PROBE.length)
  if (!prefix && !suffix) return 'opaque'
  if (!tool.startsWith(prefix) || !tool.endsWith(suffix)) return 'unmatched'
  const inner = tool.slice(prefix.length, suffix.length ? -suffix.length : undefined)
  return inner.indexOf(mid, 1) >= 0 ? 'matched' : 'unmatched'
}

/** Expected engine-formatted name for a raw LilBot system or T3 tool, or null when `tool` must match verbatim. */
export function expectedToolName(namer: ToolNamer, tool: string): string | null {
  if (!RAW_TOOL.test(tool) || tool.startsWith(SERVICE_PREFIX)) return null
  return namer(tool.startsWith('lilbot_') ? SYSTEM_SERVER : T3_SERVER, tool)
}

/** Whether a tool name reported by a bot's engine belongs to LilBot (system, T3, or a bot-added MCP service). */
export function isOwnedTool(namer: ToolNamer, tool: string, catalog: { services?: CallingToolCatalog['services']; t3Set: ReadonlySet<string> }): boolean {
  if (tool.startsWith('lilbot_')) return true
  if (matchesServerTemplate(namer, SYSTEM_SERVER, tool)) return true
  if (matchesServerTemplate(namer, T3_SERVER, tool)) return true
  if (namer(T3_SERVER, TOOL_PROBE) === TOOL_PROBE && catalog.t3Set.has(tool)) return true
  const svc = matchesServiceTemplate(namer, tool)
  if (svc === 'matched') return true
  if (svc === 'unmatched') return false
  if (!catalog.services) return false
  for (const service of catalog.services()) {
    const sample = namer(service.server, TOOL_PROBE)
    if (sample === TOOL_PROBE) {
      if (service.tools.includes(tool)) return true
      continue
    }
    const idx = sample.indexOf(TOOL_PROBE)
    if (idx >= 0 && tool.startsWith(sample.slice(0, idx)) && tool.endsWith(sample.slice(idx + TOOL_PROBE.length))) return true
    if (service.tools.some(t => namer(service.server, t) === tool)) return true
  }
  return false
}
