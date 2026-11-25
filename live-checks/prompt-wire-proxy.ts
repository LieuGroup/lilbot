/** Loopback HTTP capture proxy for `live-checks/prompt-check.ts`.
 *  Forwards dev CLIProxyAPI requests verbatim while recording the outbound system prompt,
 *  cache_control presence, tool count, and HTTP status without logging keys or upstream URLs. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { devPort } from '../scripts/dev-paths'

export interface CapturedRequest {
  path: string
  model: string
  systemKind: 'string' | 'blocks' | 'instructions' | 'messages' | 'none'
  systemText: string
  hasCacheControl: boolean
  toolCount: number
  status: number
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

export function startWireCaptureProxy(upstreamBaseUrl: string) {
  const port = devPort()
  const records: CapturedRequest[] = []
  const upstream = upstreamBaseUrl.replace(/\/+$/, '')
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    idleTimeout: 120,
    async fetch(request) {
      const start = Date.now()
      const url = new URL(request.url)
      const target = `${upstream}${url.pathname}${url.search}`
      const rawBody = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
      const parsed = rawBody ? safeJson(new TextDecoder().decode(rawBody)) : null
      const headers = new Headers(request.headers)
      headers.delete('host')
      const response = await fetch(target, { method: request.method, headers, body: rawBody })
      if (parsed && (url.pathname.includes('/messages') || url.pathname.includes('/chat/completions') || url.pathname.includes('/responses'))) {
        const extracted = extractSystem(parsed)
        records.push({
          path: url.pathname,
          model: typeof parsed.model === 'string' ? parsed.model : '',
          ...extracted,
          toolCount: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
          status: response.status,
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
