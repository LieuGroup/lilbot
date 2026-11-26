/** Outside-access guard for live checks that give a model real tools (used by `prompt-wire-proxy.ts`).
 *  The capture proxy reads every tool call in a model's answer before the engine sees it, and in the history of every
 *  request. A call that names a path outside the allowed roots (the temporary bots' workspaces), escapes its working
 *  folder with `..`, reads the home folder, opens a URL, or uses a tool that acts on a real computer or an outside
 *  service is refused: the engine gets an error instead of the call, so it never runs, and the check stops and fails.
 *  Paths are reported; nothing the call would have read is. */
import { homedir } from 'node:os'
import { isAbsolute, normalize, resolve } from 'node:path'

export interface ToolCall {
  name: string
  args: Record<string, unknown>
}

const OUTSIDE_TOOLS = /lilbot_computer|lilbot_connection|^(manage_connections|web_search|web_extract|x_search|computer_use|browser_\w+)$/
const PATH_KEYS = new Set(['path', 'file_path', 'filepath', 'workdir', 'cwd', 'dir', 'directory', 'folder'])
const SHELL_KEYS = new Set(['command', 'cmd', 'script'])
const CODE_KEYS = new Set(['code'])
const DEVICES = new Set(['/dev/null', '/dev/stdout', '/dev/stderr'])
const HOME_WORDS = /\$HOME\b|\$\{HOME\}|expanduser|Path\.home|getenv\(\s*['"]HOME|environ\[\s*['"]HOME|https?:\/\//
const SHELL_TOKEN = /(?:^|[\s'"`=:(\[,;|&<>{])(~[^\s'"`;|&<>)\]},]*|\.\.(?:\/[^\s'"`;|&<>)\]},]*)?|\/[^\s'"`;|&<>)\]},]*)/g
const CODE_TOKEN = /['"](~[^'"]*|\.\.(?:\/[^'"]*)?|\/[^'"\s]*)/g
const BARE_CD = /(?:^|[;&|]\s*)cd\s*(?:$|[;&|])/m
const PATCH_FILE = /^\*\*\* (?:Update File|Add File|Delete File|Move to): *(.+)$/gm

function reach(path: string, roots: string[]): string | null {
  const value = path.trim()
  if (!value || DEVICES.has(value)) return null
  if (!value.startsWith('~') && !isAbsolute(value)) return normalize(value).split('/')[0] === '..' ? value : null
  const full = resolve(value.startsWith('~') ? homedir() + value.slice(1) : value)
  return roots.some(root => full === root || full.startsWith(`${root}/`)) ? null : value
}

/** Why `call` reaches outside `roots`, or null when it stays inside. */
export function outsideReach(call: ToolCall, roots: string[]): string | null {
  if (call.name === 'tool_call') {
    for (const inner of bridgedCalls(call.args)) {
      const why = outsideReach(inner, roots)
      if (why) return why
    }
    return null
  }
  if (OUTSIDE_TOOLS.test(call.name)) return `${call.name} acts outside the development area`
  for (const [key, value] of Object.entries(call.args)) {
    if (typeof value !== 'string') continue
    const found = PATH_KEYS.has(key)
      ? reach(value, roots)
      : key === 'patch'
        ? [...value.matchAll(PATCH_FILE)].map(m => reach(m[1]!, roots)).find(Boolean)
        : SHELL_KEYS.has(key) || CODE_KEYS.has(key)
          ? (value.match(HOME_WORDS)?.[0] ??
            (SHELL_KEYS.has(key) && BARE_CD.test(value) ? 'cd' : null) ??
            [...value.matchAll(SHELL_KEYS.has(key) ? SHELL_TOKEN : CODE_TOKEN)].map(m => reach(m[1]!, roots)).find(Boolean))
          : null
    if (found) return `${call.name} ${key} reaches ${found}${PATH_KEYS.has(key) ? '' : ` in: ${value.replace(/\s+/g, ' ').slice(0, 160)}`}`
  }
  return null
}

function argsOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : { command: raw }
  } catch {
    return { command: raw }
  }
}

function bridgedCalls(args: Record<string, unknown>): ToolCall[] {
  const raw = typeof args.calls === 'string' ? argsOf(args.calls) : (args.calls ?? (args.name ? [args] : []))
  return (Array.isArray(raw) ? raw : [raw]).map((c: any) => ({ name: String(c?.name ?? ''), args: argsOf(c?.arguments) }))
}

/** Every complete tool call in a request body or a non-streamed answer, in any of the three wire formats. */
function walk(value: unknown, out: ToolCall[]) {
  if (Array.isArray(value)) {
    for (const v of value) walk(v, out)
    return
  }
  if (!value || typeof value !== 'object') return
  const o = value as Record<string, any>
  if (o.type === 'tool_use' && typeof o.name === 'string') out.push({ name: o.name, args: argsOf(o.input) })
  else if (o.type === 'function_call' && typeof o.name === 'string') out.push({ name: o.name, args: argsOf(o.arguments) })
  else if (o.function && typeof o.function.name === 'string') out.push({ name: o.function.name, args: argsOf(o.function.arguments) })
  for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, out)
}

export function toolCallsInRequest(body: unknown): ToolCall[] {
  const out: ToolCall[] = []
  const b = body as Record<string, unknown>
  walk([b?.messages, b?.input], out)
  return out
}

/** Every tool call in a model's answer, streamed (server-sent events, rebuilt from their pieces) or not. */
export function toolCallsInResponse(text: string): ToolCall[] {
  const out: ToolCall[] = []
  if (text.trimStart().startsWith('{')) {
    walk(argsOf(text), out)
    return out
  }
  const blocks = new Map<string, { name: string; json: string; input?: unknown }>()
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const event = argsOf(line.slice(5).trim()) as Record<string, any>
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use')
      blocks.set(`a${event.index}`, { name: String(event.content_block.name), json: '', input: event.content_block.input })
    else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const block = blocks.get(`a${event.index}`)
      if (block) block.json += event.delta.partial_json ?? ''
    } else if (event.type === 'response.output_item.done' || event.type === 'response.completed') walk(event, out)
    for (const call of event.choices?.[0]?.delta?.tool_calls ?? []) {
      const block = blocks.get(`o${call.index ?? 0}`) ?? { name: '', json: '' }
      block.name ||= call.function?.name ?? ''
      block.json += call.function?.arguments ?? ''
      blocks.set(`o${call.index ?? 0}`, block)
    }
  }
  for (const block of blocks.values()) out.push({ name: block.name, args: block.json ? argsOf(block.json) : argsOf(block.input) })
  return out
}
