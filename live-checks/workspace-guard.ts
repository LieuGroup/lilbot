/** Stops a live check when a temporary bot's tool call names a path outside the places the check allows (its own
 *  scratch folder and the development home). Reads the calls Hermes recorded in each test profile's own state file and
 *  reports only the paths, never what was read. `$HOME`, `${HOME}` and `~` count as the home folder, and a relative
 *  path that climbs with `..` is resolved from the bot's working folder. */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PATH = /(?:^|[\s"'`=:(;|&<>])((?:~|\/|\.\.\/)[^\s"'`;|&<>)\\]*|\.\.(?=[\s"'`;|&<>)\\]|$))/g
const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`\\]*/gi
const HARMLESS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr'])

/** Every path the bots' recorded tool calls name outside `allowed`; `cwd` gives each bot's working folder. */
function pathsOutside(natives: string[], allowed: string[], cwd: (native: string) => string): string[] {
  const home = process.env.HOME ?? ''
  const roots = allowed.map(root => resolve(root))
  const found = new Set<string>()
  for (const native of natives) {
    const file = join(process.env.HERMES_HOME!, 'profiles', native, 'state.db')
    if (!existsSync(file)) continue
    const state = new Database(file, { readonly: true })
    try {
      const rows = state.query("SELECT tool_calls FROM messages WHERE role = 'assistant' AND tool_calls IS NOT NULL").all() as { tool_calls: string }[]
      for (const { tool_calls } of rows) {
        const text = tool_calls
          .replace(/\\\//g, '/')
          .replace(URL, '')
          .replace(/\$\{HOME\}|\$HOME\b/g, '~')
        for (const [, raw] of text.matchAll(PATH)) {
          const path = raw.startsWith('~') ? resolve(join(home, raw.slice(1))) : resolve(cwd(native), raw)
          if (path === '/' || HARMLESS.has(path) || roots.some(root => path === root || path.startsWith(`${root}/`))) continue
          found.add(path)
        }
      }
    } finally {
      state.close()
    }
  }
  return [...found].sort()
}

/** Throws when a test bot (`bots`: LilBot id and engine id) named a path outside `allowed`. Each bot works in
 *  `<workspaces>/<bot id>`. Call it while the check waits, so the check stops at once, and once more at the end. */
export function assertInside(bots: { id: string; engine_bot_id: string }[], allowed: string[], workspaces: string) {
  const cwd = (native: string) => join(workspaces, bots.find(bot => bot.engine_bot_id === native)?.id ?? '')
  const outside = pathsOutside(
    bots.map(bot => bot.engine_bot_id),
    allowed,
    cwd
  )
  if (outside.length) throw new Error(`A test bot's tool call named paths outside its workspace and the development area: ${outside.join(', ')}`)
}

/** Runs `guard` at the end of a check and prints its outcome; false when a test bot named a path outside its area. */
export function guardPassed(guard: () => void): boolean {
  try {
    guard()
    console.log('ok: no tool call named a path outside the workspace and the development area')
    return true
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    return false
  }
}
