/** Per-pass outcome tracking for memory-review and pre-compress checkpoint sessions over the session-bound MCP route. */
import { LilBotError } from '../../shared/lilbot-error'

/** LilBot-owned domain rejections a review model can act on (safety filter, owner-authored fact, missing/ambiguous id).
 *  Everything else (auth, transport, unknown tool, schema, persistence) is a hard failure that fails the pass. */
const REVIEW_DOMAIN_REFUSAL_CODES = new Set(['invalid_fact', 'fact_refused', 'fact_removed_by_user', 'fact_protected', 'fact_not_found', 'fact_ambiguous'])

export interface ReviewRunSummary {
  botId: string
  grantId: string
  listed: boolean
  grantLive: boolean
  hardFailures: number
  writesAttempted: number
  writesSucceeded: number
  savesAttempted: number
  savesSaved: number
  /** Count of model-actionable domain rejections keyed strictly by error code (never fact text). */
  domainRefusals: Record<string, number>
}

export class ReviewOutcomeTracker {
  private runs = new Map<string, ReviewRunSummary>()

  begin(grantId: string, botId: string) {
    this.runs.set(grantId, {
      botId,
      grantId,
      listed: false,
      grantLive: true,
      hardFailures: 0,
      writesAttempted: 0,
      writesSucceeded: 0,
      savesAttempted: 0,
      savesSaved: 0,
      domainRefusals: {}
    })
  }

  markListed(grantId: string) {
    const run = this.runs.get(grantId)
    if (run) run.listed = true
  }

  recordHardFailure(grantId: string) {
    const run = this.runs.get(grantId)
    if (run) run.hardFailures++
  }

  recordWriteAttempt(grantId: string, isSave: boolean) {
    const run = this.runs.get(grantId)
    if (!run) return
    run.writesAttempted++
    if (isSave) run.savesAttempted++
  }

  recordWriteSuccess(grantId: string, isSave: boolean) {
    const run = this.runs.get(grantId)
    if (!run) return
    run.writesSucceeded++
    if (isSave) run.savesSaved++
  }

  recordDomainRefusal(grantId: string, code: string) {
    const run = this.runs.get(grantId)
    if (!run) return
    run.domainRefusals[code] = (run.domainRefusals[code] ?? 0) + 1
  }

  recordError(grantId: string, error: unknown) {
    if (error instanceof LilBotError && REVIEW_DOMAIN_REFUSAL_CODES.has(error.code)) {
      this.recordDomainRefusal(grantId, error.code)
      return
    }
    this.recordHardFailure(grantId)
  }

  finish(grantId: string, botId: string, listedFromGrant: boolean, grantLive = true): ReviewRunSummary {
    const run = this.runs.get(grantId)
    this.runs.delete(grantId)
    if (!run) {
      return {
        botId,
        grantId,
        listed: listedFromGrant,
        grantLive,
        hardFailures: 0,
        writesAttempted: 0,
        writesSucceeded: 0,
        savesAttempted: 0,
        savesSaved: 0,
        domainRefusals: {}
      }
    }
    return { ...run, listed: run.listed || listedFromGrant, grantLive }
  }

  discard(grantId: string) {
    this.runs.delete(grantId)
  }
}

/** Enforces fail-closed completion of a review or checkpoint pass:
 *  - `tools/list` must have arrived on this pass's MCP connection (catches silent discovery drops).
 *  - Zero hard failures (auth, unknown tool, schema, JSON-RPC, unexpected/persistence error).
 *  - If any write was attempted, at least one must have succeeded; if any save was attempted, at least one must have
 *    been saved (a safety filter rejecting every save must never let compression proceed with nothing kept). */
export function assertReviewRunOk(summary: ReviewRunSummary) {
  if (Object.keys(summary.domainRefusals).length > 0) {
    console.info(
      `[memory-review] pass domain refusals (bot=${summary.botId}, saves=${summary.savesSaved}/${summary.savesAttempted}, writes=${summary.writesSucceeded}/${summary.writesAttempted}): ${JSON.stringify(summary.domainRefusals)}`
    )
  }
  if (!summary.listed) {
    throw new LilBotError('review_failed', 'The memory review session did not connect to its memory tools.')
  }
  if (!summary.grantLive) {
    throw new LilBotError('review_failed', 'The memory review session grant expired or was revoked before completion.')
  }
  if (summary.hardFailures > 0) {
    throw new LilBotError('review_failed', 'One or more memory review tool calls failed.')
  }
  if (summary.savesAttempted > 0 && summary.savesSaved === 0) {
    throw new LilBotError('review_failed', 'Every memory save attempted by the review was refused.')
  }
  if (summary.writesAttempted > 0 && summary.writesSucceeded === 0) {
    throw new LilBotError('review_failed', 'Every memory write attempted by the review was refused.')
  }
}
