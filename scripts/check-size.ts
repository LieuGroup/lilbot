/** Fails when a tracked source file passes the line limit or `AGENTS.md` grows past its size cap / breaks a `docs/` link.
 *  Files listed in `size-exceptions.json` (with their line count) may stay as they are but never grow; a listed file that
 *  is back under the limit, or gone, must leave the list. */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import exceptions from './size-exceptions.json'
import { trackedSourceFiles } from './source-files'

export const AGENTS_LIMIT = { maxLines: 650, maxBytes: 61_440 }

export function checkAgentsDoc(root = process.cwd(), limits = AGENTS_LIMIT): string[] {
  const problems: string[] = []
  const file = resolve(root, 'AGENTS.md')
  if (!existsSync(file)) return ['AGENTS.md: missing.']
  const text = readFileSync(file, 'utf8')
  const bytes = Buffer.byteLength(text, 'utf8')
  const lines = text.length === 0 ? 0 : text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
  if (lines > limits.maxLines) {
    problems.push(`AGENTS.md: ${lines} lines, over the ${limits.maxLines}-line limit. Move area-specific detail into docs/<area>.md and link it from AGENTS.md.`)
  }
  if (bytes > limits.maxBytes) {
    problems.push(`AGENTS.md: ${bytes} bytes, over the ${limits.maxBytes}-byte (60 KiB) limit. Move area-specific detail into docs/<area>.md and link it from AGENTS.md.`)
  }
  for (const match of text.matchAll(/\]\((docs\/[^)#\s]+)(?:#[^)\s]+)?\)/g)) {
    const rel = match[1]
    if (!existsSync(resolve(root, rel))) problems.push(`AGENTS.md: broken link to ${rel} (file does not exist).`)
  }
  return problems
}

if (import.meta.main) {
  const { limit, files: allowed } = exceptions as { limit: number; files: Record<string, number> }
  const problems: string[] = []
  const seen = new Set<string>()
  for (const { path, lines } of await trackedSourceFiles()) {
    seen.add(path)
    const cap = allowed[path]
    if (cap === undefined) {
      if (lines > limit) problems.push(`${path}: ${lines} lines, over the ${limit}-line limit. Split it by responsibility.`)
    } else if (lines > cap) problems.push(`${path}: grew to ${lines} lines (exception allows ${cap}). Split it instead.`)
    else if (lines <= limit) problems.push(`${path}: ${lines} lines, now within the limit. Remove it from scripts/size-exceptions.json.`)
  }
  for (const path of Object.keys(allowed)) if (!seen.has(path)) problems.push(`${path}: no longer tracked. Remove it from scripts/size-exceptions.json.`)
  problems.push(...checkAgentsDoc())
  if (problems.length) {
    console.error(`File size check failed:\n${problems.map(p => `  ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`File size check: ${seen.size} files, ${Object.keys(allowed).length} listed exceptions, AGENTS.md within limits.`)
}
