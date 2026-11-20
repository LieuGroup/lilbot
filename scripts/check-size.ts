/** Fails when a tracked source file passes the line limit. Files listed in `size-exceptions.json` (with their line count)
 *  may stay as they are but never grow; a listed file that is back under the limit, or gone, must leave the list. */
import exceptions from './size-exceptions.json'
import { trackedSourceFiles } from './source-files'

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
if (problems.length) {
  console.error(`File size check failed:\n${problems.map(p => `  ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`File size check: ${seen.size} files, ${Object.keys(allowed).length} listed exceptions.`)
