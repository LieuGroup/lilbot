/** The one guard for live checks that give a model real tools. It allows instead of forbids:
 *  - Tools: only local file, terminal and skill tools (LilBot's skills plug-in serves the skill tools from the check's
 *    own skills folder) and LilBot's own tools under the name the engine gives them (never its computer or connection
 *    tools), plus any tool a check names. Everything else (web, browser, images, the engine's connectors, code) is
 *    refused. A call in a model's answer must also name, exactly, a tool the request offers (`offered`): the engine
 *    "repairs" a name it does not offer into the closest one it does (`lilbot_execute_code` becomes `execute_code`),
 *    so a name the session does not offer is refused, whatever it looks like. Its `tool_call` bridge does no repair, so
 *    a bridged name must be an allowed name exactly.
 *  - Paths: every string in every argument, at any depth and under any name, is resolved against the bot's own folder
 *    (`..` normalised wherever it appears, links followed) and must land inside that folder or a folder the check names.
 *  - Terminal: programs from the check's short list with plain flags and paths inside, joined at most by `&&`, `;` or
 *    `|` (each part checked alone), or a whole command the check writes out. No `cd`, variables, substitutions,
 *    redirects (except `2>/dev/null` and `2>&1`), globs or other shell syntax.
 *  Used by the capture proxy (`prompt-wire-proxy.ts`), which refuses a call before the engine runs it, and by
 *  `workspace-guard.ts`, which reads the calls an engine recorded (`tool-calls-on-wire.ts` reads them off the wire).
 *  Reports paths, never anything read. */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { argsOf, type ToolCall } from './tool-calls-on-wire'

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

const FILE_TOOLS = ['read_file', 'write_file', 'patch', 'search_files', 'terminal', 'todo_list', 'clarify']
const LOCAL_TOOLS = new Set([...FILE_TOOLS, 'skills_list', 'skill_view', 'skill_manage', 'tool_search', 'tool_describe'])
/** A tool of LilBot's own server, as the engine names it: once under the server's prefix (the bot's own server, or a
 *  session's scoped copy of it). The server's exact names come from the request's tool list (`offered`). */
const LILBOT_TOOL = /^mcp__(?:lilbot_system|editor_lilbot_system_[0-9a-f]{8})__(lilbot_[a-z_]+)$/
const LILBOT_OUTSIDE = /^lilbot_(?:computer|connection)/
const HARMLESS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr'])
/** The Library address `lilbot_give_file` answers with, which bots quote as evidence: a LilBot route, not a file. */
const LIBRARY_ROUTE = /^\/api\/library\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/
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
  if (!word || HARMLESS.has(word) || LIBRARY_ROUTE.test(word)) return null
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
  const parts = command.split(/&&|;|\|/).filter(part => part.trim())
  if (!parts.length) return 'an empty command'
  for (const part of parts) {
    const why = simpleRefusal(part.replace(/\s2>(?:\/dev\/null|&1)(?=\s|$)/g, ' '), folder, allowed, policy)
    if (why) return `${why}, in "${clip(command)}"`
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

/** Why `call`, made by a bot working in `folder`, is refused under `policy`, or null when it is allowed. `offered` is
 *  the tool list of the request the call answers; leave it out for a call the engine already ran (history), whose name
 *  is the one it ran. */
export function refusal(call: ToolCall, folder: string, policy: GuardPolicy, offered?: readonly string[]): string | null {
  if (offered && !offered.includes(call.name)) return `${call.name || 'an unnamed tool'} is not a tool this session offers`
  const bridged = call.name === 'tool_call' ? bridgedCalls(call.args) : null
  // The engine refuses a whole bridge call with an entry it cannot name, so only its paths are checked.
  if (bridged?.every(inner => inner.name)) return bridged.reduce<string | null>((why, inner) => why ?? refusal(inner, folder, policy), null)
  const lilbot = call.name.match(LILBOT_TOOL)?.[1]
  const local = bridged || LOCAL_TOOLS.has(call.name) || (lilbot && !LILBOT_OUTSIDE.test(lilbot))
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

function bridgedCalls(args: Record<string, unknown>): ToolCall[] {
  const raw = typeof args.calls === 'string' ? argsOf(args.calls) : (args.calls ?? (args.name ? [args] : []))
  const entries = Array.isArray(raw) ? raw : [raw]
  return entries.length ? entries.map((c: any) => ({ name: typeof c?.name === 'string' ? c.name.trim() : '', args: argsOf(c?.arguments) })) : [{ name: '', args: {} }]
}
