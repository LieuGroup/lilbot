import type { ComputerResult } from '../shared/computer-schema'

// Leave ample room for the frame envelope; JSON escaping can cost six bytes per character.
export const RESULT_JSON_LIMIT = 6_000_000
export const TRUNCATED = '\n[Result truncated]'
export function boundResult(result: ComputerResult): ComputerResult {
  const bounded = { ...result, error: result.error?.slice(0, 1000) }
  if (Buffer.byteLength(JSON.stringify(bounded)) <= RESULT_JSON_LIMIT) return bounded
  let low = 0
  let high = bounded.output.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(JSON.stringify({ ...bounded, output: bounded.output.slice(0, mid) + TRUNCATED })) <= RESULT_JSON_LIMIT) low = mid
    else high = mid - 1
  }
  return { ...bounded, output: bounded.output.slice(0, low) + TRUNCATED }
}
