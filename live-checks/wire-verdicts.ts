/** What the prompt live checks conclude from the capture proxy's records (`prompt-wire-proxy.ts`). */
import { type CapturedRequest, findForbiddenStockSnippets } from './prompt-wire-proxy'

const ACCOUNT_STOP = /\b403\b|disabled in this account|violation of terms|unknown provider/i

/** Throws at once on a tool call that ran outside what the guard allows, on any tool call the guard refused unless
 *  `onRefusal` is 'go on', and on any 403, account message or unknown-provider answer since record `from` or in a
 *  failed turn. */
export function stopOnAccountProblem(records: CapturedRequest[], from = 0, finished?: { type?: string; message?: string; text?: string }, onRefusal: 'stop' | 'go on' = 'stop') {
  const breach = records.find(r => r.breach)
  if (breach) throw new Error(`Stopped: a tool call the live check guard does not allow ran (${breach.breach}).`)
  const outside = onRefusal === 'stop' && records.find(r => r.outside)
  if (outside) throw new Error(`Stopped: the live check guard refused a tool call (${outside.outside}).`)
  const bad = records.slice(from).find(r => r.status === 403 || ACCOUNT_STOP.test(r.error ?? ''))
  const text = finished?.type === 'error' ? `${finished.message ?? ''} ${finished.text ?? ''}` : ''
  if (bad || ACCOUNT_STOP.test(text))
    throw new Error(`Stopped: upstream refused with an account or 403 answer (${bad ? `HTTP ${bad.status} ${bad.error ?? ''}`.trim() : text.trim().slice(0, 120)}).`)
}

/** Every captured request answered 200 and carried exactly `prompt` as its system prompt, with no stock engine text. */
export const exact = (wire: CapturedRequest[], prompt: string) =>
  wire.length > 0 && wire.every(r => r.status === 200 && r.systemText === prompt && findForbiddenStockSnippets(r.systemText).length === 0)

/** Why each captured request fails `exact`, for a failing scenario's reason. */
export const wireProblems = (wire: CapturedRequest[], prompt: string) =>
  wire.length === 0
    ? ['no request']
    : wire
        .filter(r => !exact([r], prompt))
        .map(r =>
          r.status !== 200
            ? `HTTP ${r.status} ${r.error ?? ''}`.trim()
            : r.systemText === prompt
              ? 'stock engine text'
              : `another system prompt (${r.systemText.length} chars, ${r.model})`
        )
