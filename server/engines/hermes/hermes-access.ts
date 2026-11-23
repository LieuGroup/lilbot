/** Maps LilBot's engine-neutral hidden-run access scopes to Hermes toolset lists. */
import type { RunAccessScope } from '../bot-engine'

/** What a check session starts with on Hermes: reading the web, images, files and command output, skills (for the
 *  lilbot-check skill) and LilBot's own MCP server (which refuses writes and memory). Not memory, scheduling,
 *  delegation or coding. Files and the terminal can still write: read-only stays an instruction there. */
const CHECK_TOOLSETS = ['web', 'vision', 'terminal', 'file', 'skills', 'lilbot_system']

const SCOPE_TOOLSETS: Record<RunAccessScope, readonly string[]> = {
  check: CHECK_TOOLSETS
}

/** Toolsets Hermes should start a hidden session with; undefined means full access (every toolset). */
export function hermesToolsetsForRun(access?: RunAccessScope, legacyToolsets?: string[]): string[] | undefined {
  if (access) return [...SCOPE_TOOLSETS[access]]
  return legacyToolsets
}
