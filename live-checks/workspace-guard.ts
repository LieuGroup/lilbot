/** Fails a live check when a temporary bot's tool call names a path outside the places the check allows (its own
 *  scratch folder and the development home). Reads the calls Hermes recorded in each test profile's own state file and
 *  reports only the paths, never what was read. */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PATH = /(?:^|[\s"'=:(])((?:~|\/)[^\s"'`;|&<>)\\]*)/g
const HARMLESS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr'])

/** Every absolute path the bots' recorded tool calls name, outside `allowed` roots. */
export function pathsOutside(natives: string[], allowed: string[]): string[] {
  const home = process.env.HOME ?? ''
  const roots = allowed.map(root => resolve(root))
  const found = new Set<string>()
  for (const native of natives) {
    const file = join(process.env.HERMES_HOME!, 'profiles', native, 'state.db')
    if (!existsSync(file)) continue
    const state = new Database(file, { readonly: true })
    try {
      const rows = state.query("SELECT tool_calls FROM messages WHERE role = 'assistant' AND tool_calls IS NOT NULL").all() as { tool_calls: string }[]
      for (const { tool_calls } of rows)
        for (const [, raw] of tool_calls
          .replace(/\\\//g, '/')
          .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`\\]*/gi, '')
          .matchAll(PATH)) {
          const path = resolve(raw.startsWith('~') ? join(home, raw.slice(1)) : raw)
          if (path === '/' || HARMLESS.has(path) || roots.some(root => path === root || path.startsWith(`${root}/`))) continue
          found.add(path)
        }
    } finally {
      state.close()
    }
  }
  return [...found].sort()
}
