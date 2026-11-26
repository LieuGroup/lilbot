/** Conversation search over LilBot's own main conversation record (`HistoryService.search`). Caller identity comes
 *  strictly from the bot-bound key, never an argument, and hidden sessions (routines, webhooks, exchanges, reviews,
 *  checks) and their compression continuations stay excluded, failing closed when lineage cannot be read. */
import { HistorySearchInput } from '../history/history-search'
import { type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

export function historyTools({ history }: SystemDeps): McpTool[] {
  return [
    readTool(
      'lilbot_history_search',
      'Search your own past conversations with the owner (excludes other bots and hidden runs). Returns snippets with ids, times and import progress.',
      HistorySearchInput,
      async (caller, { query, limit }) => history.search(caller, query, limit)
    )
  ]
}
