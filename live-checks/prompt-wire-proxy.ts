/** Loopback HTTP capture proxy for the prompt live checks.
 *  Forwards dev CLIProxyAPI requests verbatim while recording the outbound system prompt,
 *  cache_control presence, tool count, and HTTP status without logging keys or upstream URLs.
 *  With a guard, it refuses any tool call the guard does not allow before the engine runs it (`outside-access-guard.ts`):
 *  each bot's folder is read from its system note and must lie inside `workspaces`. A refused call in the model's answer
 *  is renamed `REFUSED_TOOL`, which the engine does not have: it runs nothing, tells the model the tool does not exist,
 *  and the turn goes on. A refused call already in the request history ran (the guard missed it in the answer): that
 *  request is not forwarded, and it is a breach. */
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { devPort } from '../scripts/dev-paths'
import { folderOf, type GuardPolicy, refusal } from './outside-access-guard'
import { toolCallsInRequest as inRequest, toolCallsInResponse as inAnswer } from './tool-calls-on-wire'
import { type RestartServer, waitFor } from './restart-server'

export interface CapturedRequest {
  path: string
  model: string
  systemKind: 'string' | 'blocks' | 'instructions' | 'messages' | 'none'
  systemText: string
  hasCacheControl: boolean
  toolCount: number
  toolNames: string[]
  /** Whether the request's messages carry LilBot's per-turn `[LilBot date: ...]` line. */
  hasDateLine: boolean
  status: number
  error?: string
  /** The bot's folder as the request's system note states it, when it lies inside the guard's workspaces. */
  folder?: string
  /** Why the guard refused a tool call in this request's answer; the engine never ran it. */
  outside?: string
  /** Why a tool call the guard does not allow is in this request's history, so it ran. */
  breach?: string
  elapsedMs: number
}
const FORBIDDEN_STOCK_SNIPPETS = ['Hermes Agent', 'hermes-agent', 'Mid-turn user steering', 'Hermes runtime environment', 'Hermes desktop app', 'Nous Research'] as const

export function findForbiddenStockSnippets(systemText: string): string[] {
  const lower = systemText.toLowerCase()
  return FORBIDDEN_STOCK_SNIPPETS.filter(snippet => lower.includes(snippet.toLowerCase()))
}

/** Reads the dev Hermes CLIProxyAPI upstream URL from `$HERMES_HOME/config.yaml` (never printed). */
export function readDevUpstreamBaseUrl(): string {
  const hermesHome = process.env.HERMES_HOME
  if (!hermesHome) throw new Error('HERMES_HOME is not set; import scripts/dev-env first.')
  const raw = readFileSync(join(hermesHome, 'config.yaml'), 'utf8')
  const section = raw.match(/cliproxyapi:\s*\n((?:[ \t]+.*\n?)*)/)
  const url = section?.[1]?.match(/base_url:\s*["']?([^"'\s#]+)/)?.[1]
  if (!url) throw new Error('Could not find providers.cliproxyapi.base_url in dev Hermes config.yaml.')
  return url.replace(/\/+$/, '')
}

function extractSystem(body: Record<string, unknown>): Pick<CapturedRequest, 'systemKind' | 'systemText' | 'hasCacheControl'> {
  const sys = body.system
  if (typeof sys === 'string') return { systemKind: 'string', systemText: sys, hasCacheControl: false }
  if (Array.isArray(sys)) {
    const texts = sys.map(block => (block && typeof block === 'object' && 'text' in block ? String((block as { text?: unknown }).text ?? '') : ''))
    const hasCacheControl = sys.some(block => Boolean(block && typeof block === 'object' && ('cache_control' in block || 'cachePoint' in block)))
    return { systemKind: 'blocks', systemText: texts.join('\n\n'), hasCacheControl }
  }
  if (typeof body.instructions === 'string') return { systemKind: 'instructions', systemText: body.instructions, hasCacheControl: false }
  if (Array.isArray(body.messages) && body.messages[0] && typeof body.messages[0] === 'object' && (body.messages[0] as { role?: unknown }).role === 'system') {
    const content = (body.messages[0] as { content?: unknown }).content
    return { systemKind: 'messages', systemText: typeof content === 'string' ? content : JSON.stringify(content), hasCacheControl: false }
  }
  return { systemKind: 'none', systemText: '', hasCacheControl: false }
}

const REFUSED = { type: 'error', error: { type: 'invalid_request_error', message: 'Live check guard: this tool call is not allowed in a live check.' } }
export const REFUSED_TOOL = 'refused_by_live_check_guard'
const renamed = (answer: string, names: string[]) =>
  names.reduce((text, name) => text.replace(new RegExp(`("name"\\s*:\\s*")${name.replace(/[^\w]/g, '\\$&')}"`, 'g'), `$1${REFUSED_TOOL}"`), answer)

export function startWireCaptureProxy(upstreamBaseUrl: string, guard?: { workspaces: string[]; policy: GuardPolicy }) {
  const port = devPort()
  const records: CapturedRequest[] = []
  const upstream = upstreamBaseUrl.replace(/\/+$/, '')
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    idleTimeout: 255,
    async fetch(request) {
      const start = Date.now()
      const url = new URL(request.url)
      const target = `${upstream}${url.pathname}${url.search}`
      const rawBody = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
      const parsed = rawBody ? safeJson(new TextDecoder().decode(rawBody)) : null
      const headers = new Headers(request.headers)
      headers.delete('host')
      const stated = guard && folderOf(parsed ? extractSystem(parsed).systemText : '', guard.workspaces)
      const folder = guard && (stated ?? guard.workspaces[0]!)
      const offered = Array.isArray(parsed?.tools) ? parsed.tools.map(toolName) : []
      const reached = (calls: ReturnType<typeof inRequest>, answer?: true) =>
        guard && folder
          ? calls.filter(c => c.name !== REFUSED_TOOL).flatMap(c => (why => (why ? [{ name: c.name, why }] : []))(refusal(c, folder, guard.policy, answer && offered)))
          : []
      const breach = parsed ? reached(inRequest(parsed))[0]?.why : undefined
      const upstreamResponse = breach ? Response.json({}, { status: 451 }) : await fetch(target, { method: request.method, headers, body: rawBody })
      const outHeaders = new Headers(upstreamResponse.headers)
      for (const name of ['content-encoding', 'content-length', 'transfer-encoding']) outHeaders.delete(name)
      const errorText = upstreamResponse.status >= 400 ? (await upstreamResponse.clone().text()).replace(/\s+/g, ' ').slice(0, 240) : undefined
      const answer = guard && !breach ? await upstreamResponse.text() : undefined
      const refused = answer === undefined ? [] : reached(inAnswer(answer), true)
      const outside = refused.map(r => r.why).join('; ') || undefined
      const { status, statusText } = upstreamResponse
      const body = refused.length
        ? renamed(
            answer!,
            refused.map(r => r.name)
          )
        : answer
      const unsafe = refused.length > 0 && reached(inAnswer(body!), true).length > 0
      const response = unsafe ? Response.json(REFUSED, { status: 400 }) : new Response(body ?? upstreamResponse.body, { status, statusText, headers: outHeaders })
      if (parsed && (url.pathname.includes('/messages') || url.pathname.includes('/chat/completions') || url.pathname.includes('/responses'))) {
        const extracted = extractSystem(parsed)
        records.push({
          path: url.pathname,
          model: typeof parsed.model === 'string' ? parsed.model : '',
          ...extracted,
          toolCount: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
          toolNames: offered,
          hasDateLine: JSON.stringify(parsed.messages ?? parsed.input ?? '').includes('[LilBot date: '),
          status: response.status,
          ...(errorText ? { error: errorText } : {}),
          ...(stated ? { folder: stated } : {}),
          ...(outside ? { outside } : {}),
          ...(breach ? { breach } : {}),
          elapsedMs: Date.now() - start
        })
      }
      return response
    }
  })
  return {
    url: `http://127.0.0.1:${port}`,
    records,
    stop: () => server.stop(true)
  }
}

function toolName(tool: unknown): string {
  const t = tool as { name?: unknown; function?: { name?: unknown } }
  return String(t?.name ?? t?.function?.name ?? '')
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Points a temporary `dev-` profile's CLIProxyAPI base_url at the local capture proxy (or back to upstream). */
export async function setProfileBaseUrl(profileId: string, baseUrl: string) {
  if (!profileId.startsWith('dev-')) throw new Error(`Refusing to touch non-dev profile: ${profileId}`)
  const bin = process.env.LILBOT_HERMES_BIN ?? 'hermes'
  const proc = Bun.spawn([bin, '-p', profileId, 'config', 'set', 'providers.cliproxyapi.base_url', baseUrl], {
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`hermes config set base_url failed (${code}): ${stderr.trim().slice(0, 200)}`)
}

export function nativeProfileOf(root: string, botId: string): string {
  const db = new Database(join(root, 'lilbot.db'), { readonly: true })
  try {
    return (db.query('SELECT engine_bot_id FROM bots WHERE id = ?').get(botId) as { engine_bot_id: string }).engine_bot_id
  } finally {
    db.close()
  }
}

export async function sendPromptTurn(server: RestartServer, botId: string, chatId: string, text: string) {
  const startIdx = server.events.length
  await server.call('chat.send', { botId, chatId, text, messageId: crypto.randomUUID() })
  const finished: any = await waitFor(
    `turn finished (${text.slice(0, 24)})`,
    async () => server.events.slice(startIdx).find(e => e.event === 'chat' && e.chatId === chatId && (e.data?.type === 'turn.finished' || e.data?.type === 'error')),
    Boolean,
    120_000
  )
  const reply = server.events
    .slice(startIdx)
    .filter(e => e.event === 'chat' && e.chatId === chatId && e.data?.type === 'text.delta')
    .map(e => String(e.data.text ?? ''))
    .join('')
  return { finished: finished?.data, reply }
}
