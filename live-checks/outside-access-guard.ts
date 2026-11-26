/** The one guard for live checks that give a model real tools. It allows instead of forbids:
 *  - Tools: only local file, terminal and skill tools and LilBot's own tools (never its computer or connection tools),
 *    plus any tool a check names. Everything else (web, browser, images, the engine's connectors, code) is refused.
 *  - Paths: every string in every argument, at any depth and under any name, is resolved against the bot's own folder
 *    (`..` normalised wherever it appears, links followed) and must land inside that folder or a folder the check names.
 *  - Terminal: programs from the check's short list with plain flags and paths inside, joined at most by `&&`, `;` or
 *    `|` (each part checked alone), or a whole command the check writes out. No `cd`, variables, substitutions,
 *    redirects (except `2>/dev/null`), globs or other shell syntax.
 *  Used by the capture proxy (`prompt-wire-proxy.ts`), which refuses a call before the engine runs it, and by
 *  `workspace-guard.ts`, which reads the calls an engine recorded. Reports paths, never anything read. */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export interface ToolCall {
  name: string
  args: Record<string, unknown>
}

export interface GuardPolicy {
  /** Folders besides the bot's own that its tools may name. */
  roots: string[]
  /** Programs a terminal command may run, with plain flags and paths inside the allowed folders only. */
  programs: string[]
  /** Whole terminal commands a scenario needs beyond that, written out exactly. */
  commands?: string[]
  /** Tools a scenario names beyond the local ones every check allows. */
  tools?: string[]
}

const LOCAL_TOOLS = new Set(['read_file', 'write_file', 'patch', 'search_files', 'terminal', 'skills_list', 'skill_view', 'todo_list', 'tool_search', 'tool_describe', 'clarify'])
const LILBOT_TOOL = /^(?:mcp__(?:lilbot_system|editor_lilbot_[0-9a-f]{8})__)?(lilbot_[a-z_]+)$/
const LILBOT_OUTSIDE = /^lilbot_(?:computer|connection)/
const HARMLESS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr'])
const SHELL_SYNTAX = /[$`;|&<>(){}*?[\]!\\#~\n\r]/
const FLAG = /^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/
const SPLIT = /[\s"'`()<>,;|&=[\]{}]+/
const VARIABLE = /\$[A-Za-z_{(]/
const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i
const HOME_PATH = /^~([A-Za-z_][\w.-]*)?(\/|$)/
const clip = (text: string) => text.replace(/\s+/g, ' ').slice(0, 160)
const inside = (path: string, allowed: string[]) => allowed.some(root => path === root || path.startsWith(`${root}/`))

/** Where `path` really is: links in the part of it that exists are followed. */
function real(path: string): string {
  let probe = path
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
  try {
    return realpathSync(probe) + path.slice(probe.length)
  } catch {
    return path
  }
}

/** Why `word` (a whole argument, or one word of a longer text) is not inside `allowed`, or null. */
function pathRefusal(word: string, folder: string, allowed: string[], whole: boolean): string | null {
  if (!word || HARMLESS.has(word)) return null
  if (VARIABLE.test(word)) return word
  const scheme = word.match(SCHEME)
  if (scheme) return scheme[1]!.toLowerCase() === 'file' ? pathRefusal(word.slice(7), folder, allowed, whole) : null
  if (HOME_PATH.test(word)) return word
  if (!whole && (!/\/|^\.\.?$/.test(word) || /^\/+$/.test(word))) return null
  const lexical = resolve(folder, word)
  if (!inside(lexical, allowed)) return word
  return inside(real(lexical), allowed.map(real)) ? null : `${word} (a link out)`
}

function commandRefusal(command: string, folder: string, allowed: string[], policy: GuardPolicy): string | null {
  if (policy.commands?.includes(command.trim())) return null
  for (const part of command.split(/&&|;|\|/)) {
    const why = simpleRefusal(part.replace(/\s2>\/dev\/null(?=\s|$)/g, ' '), folder, allowed, policy)
    if (why) return why
  }
  return null
}

function simpleRefusal(command: string, folder: string, allowed: string[], policy: GuardPolicy): string | null {
  const text = command.trim()
  if (SHELL_SYNTAX.test(text)) return `shell syntax in "${clip(text)}"`
  const words = (text.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(word => word.replace(/^(['"])(.*)\1$/, '$2'))
  const [program, ...rest] = words
  if (!program || !policy.programs.includes(program)) return `"${clip(program ?? '')}" is not a program this check allows`
  for (const word of rest) {
    if (/['"]/.test(word)) return `a quote inside a word in "${clip(text)}"`
    if (word.startsWith('-') && !FLAG.test(word)) return `a flag with a value in "${clip(text)}"`
    const why = FLAG.test(word) ? null : pathRefusal(word, folder, allowed, true)
    if (why) return `"${clip(text)}" names ${why}`
  }
  return null
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) strings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out)
  return out
}

/** Why `call`, made by a bot working in `folder`, is refused under `policy`, or null when it is allowed. */
export function refusal(call: ToolCall, folder: string, policy: GuardPolicy): string | null {
  if (call.name === 'tool_call') return bridgedCalls(call.args).reduce<string | null>((why, inner) => why ?? refusal(inner, folder, policy), null)
  const lilbot = call.name.match(LILBOT_TOOL)?.[1]
  const local = LOCAL_TOOLS.has(call.name) || (lilbot && !LILBOT_OUTSIDE.test(lilbot))
  if (!local && !policy.tools?.includes(call.name)) return `${call.name || 'an unnamed tool'} is not a tool this check allows`
  const allowed = [folder, ...policy.roots].map(root => resolve(root))
  if (call.name === 'terminal') {
    const why = commandRefusal(String(call.args.command ?? ''), folder, allowed, policy)
    if (why) return `terminal: ${why}`
  }
  for (const text of strings(call.args)) {
    const value = text.trim()
    const why =
      (/\s/.test(value) ? null : pathRefusal(value, folder, allowed, true)) ??
      value
        .split(SPLIT)
        .flatMap(word => (SCHEME.test(word) ? [word] : word.split(':')))
        .map(word => pathRefusal(word, folder, allowed, false))
        .find(Boolean)
    if (why) return `${call.name} names ${why}`
  }
  return null
}

/** The bot's folder as LilBot's system note states it, when it lies inside `workspaces`. */
export function folderOf(systemText: string, workspaces: string[]): string | undefined {
  const folder = systemText.match(/Your folder is (\/\S+?)\.(?:\s|$)/m)?.[1]
  return folder &&
    inside(
      resolve(folder),
      workspaces.map(w => resolve(w))
    )
    ? resolve(folder)
    : undefined
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

/** Every complete tool call in any of the three wire formats, at any depth of `value`. */
export function toolCallsIn(value: unknown, out: ToolCall[] = []): ToolCall[] {
  if (Array.isArray(value)) {
    for (const v of value) toolCallsIn(v, out)
    return out
  }
  if (!value || typeof value !== 'object') return out
  const o = value as Record<string, any>
  if (o.type === 'tool_use' && typeof o.name === 'string') out.push({ name: o.name, args: argsOf(o.input) })
  else if (o.type === 'function_call' && typeof o.name === 'string') out.push({ name: o.name, args: argsOf(o.arguments) })
  else if (o.function && typeof o.function.name === 'string') out.push({ name: o.function.name, args: argsOf(o.function.arguments) })
  for (const v of Object.values(o)) if (v && typeof v === 'object') toolCallsIn(v, out)
  return out
}

export const toolCallsInRequest = (body: unknown) => toolCallsIn([(body as any)?.messages, (body as any)?.input])

/** Every tool call in a model's answer, streamed (server-sent events, rebuilt from their pieces) or not. An answer
 *  that mentions a tool call none of this could read counts as one unnamed call, so it is refused rather than passed. */
export function toolCallsInResponse(text: string): ToolCall[] {
  const out: ToolCall[] = []
  if (text.trimStart().startsWith('{')) toolCallsIn(argsOf(text), out)
  const blocks = new Map<string, { name: string; json: string; input?: unknown }>()
  for (const line of text.trimStart().startsWith('{') ? [] : text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const event = argsOf(line.slice(5).trim()) as Record<string, any>
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use')
      blocks.set(`a${event.index}`, { name: String(event.content_block.name), json: '', input: event.content_block.input })
    else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const block = blocks.get(`a${event.index}`)
      if (block) block.json += event.delta.partial_json ?? ''
    } else if (event.type === 'response.output_item.done' || event.type === 'response.completed') toolCallsIn(event, out)
    for (const call of event.choices?.[0]?.delta?.tool_calls ?? []) {
      const block = blocks.get(`o${call.index ?? 0}`) ?? { name: '', json: '' }
      block.name ||= call.function?.name ?? ''
      block.json += call.function?.arguments ?? ''
      blocks.set(`o${call.index ?? 0}`, block)
    }
  }
  for (const block of blocks.values()) out.push({ name: block.name, args: block.json ? argsOf(block.json) : argsOf(block.input) })
  if (!out.length && /"type"\s*:\s*"(?:tool_use|function_call)"|"tool_calls"\s*:\s*\[\s*\{/.test(text)) out.push({ name: '', args: {} })
  return out
}
