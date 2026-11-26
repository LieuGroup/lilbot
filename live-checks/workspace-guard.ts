/** Stops a live check that does not route model calls through the capture proxy when a temporary bot made a tool
 *  call the live check guard does not allow (`outside-access-guard.ts`, the one guard every live check uses). Reads
 *  the calls Hermes recorded in each test profile's own state file, so a call is caught after it ran, at the next
 *  look. Reports the reason and paths only, never what was read. */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type GuardPolicy, refusal } from './outside-access-guard'
import { toolCallsIn } from './tool-calls-on-wire'

/** Every refusal among the bots' recorded tool calls; each bot works in `<workspaces>/<bot id>`. */
function refusals(bots: { id: string; engine_bot_id: string }[], policy: GuardPolicy, workspaces: string): string[] {
  const found = new Set<string>()
  for (const bot of bots) {
    const file = join(process.env.HERMES_HOME!, 'profiles', bot.engine_bot_id, 'state.db')
    if (!existsSync(file)) continue
    const state = new Database(file, { readonly: true })
    try {
      const rows = state.query("SELECT tool_calls FROM messages WHERE role = 'assistant' AND tool_calls IS NOT NULL").all() as { tool_calls: string }[]
      for (const { tool_calls } of rows) {
        let calls: unknown
        try {
          calls = JSON.parse(tool_calls)
        } catch {
          found.add('a recorded tool call that is not JSON')
          continue
        }
        for (const call of toolCallsIn(calls)) {
          const why = refusal(call, join(workspaces, bot.id), policy)
          if (why) found.add(why)
        }
      }
    } finally {
      state.close()
    }
  }
  return [...found].sort()
}

/** Throws when a test bot (`bots`: LilBot id and engine id) made a tool call `policy` does not allow. Call it while the
 *  check waits, so the check stops at once, and once more at the end. */
export function assertInside(bots: { id: string; engine_bot_id: string }[], policy: GuardPolicy, workspaces: string) {
  const found = refusals(bots, policy, workspaces)
  if (found.length) throw new Error(`The live check guard refused a test bot's tool call: ${found.join('; ')}`)
}

/** Runs `guard` at the end of a check and prints its outcome; false when a test bot made a call the guard refuses. */
export function guardPassed(guard: () => void): boolean {
  try {
    guard()
    console.log('ok: every tool call stayed inside the workspace and the live check guard')
    return true
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    return false
  }
}
