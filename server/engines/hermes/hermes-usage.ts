/** Hermes usage, context window and compaction extraction. Reads only fields declared in Hermes'
 *  wire contract (`gateway-contract.openrpc.json`, verified by `tests/engines/hermes/hermes-contract.test.ts`). */
import type { CompactionSizes, TurnUsage } from '../../../shared/chat-schema'
import type { ContextReport } from '../bot-engine'

interface CumulativeCounters {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

const nonNeg = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined)
const pos = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined)
const delta = (curr: number | undefined, prev: number | undefined) => (curr === undefined ? undefined : prev === undefined || curr < prev ? curr : curr - prev)
const reportOf = (used: number | undefined, window: number | undefined): ContextReport | undefined =>
  used === undefined && window === undefined ? undefined : { ...(used !== undefined ? { used } : {}), ...(window !== undefined ? { window } : {}) }

/** Context size and model window from `CanonicalSnapshotInfo` or `SessionLiveInfo`. */
export function contextFromInfo(info: Record<string, any> | undefined, fresh = false): ContextReport | undefined {
  if (!info || typeof info !== 'object') return undefined
  const used = nonNeg(info.usage?.context_used)
  const window = pos(info.usage?.context_max) ?? pos(info.context_length)
  if (used !== undefined) return reportOf(used, window)
  if (fresh && window !== undefined) return { used: 0, window }
  return reportOf(undefined, window)
}

/** Stable history row id from `message.complete.persisted_turn.final_assistant_row_id`. */
export function rowIdFromComplete(nativeId: string, payload: Record<string, any>): string | undefined {
  const id = payload.persisted_turn?.final_assistant_row_id
  return typeof id === 'number' && Number.isFinite(id) ? `hermes:${nativeId}:${id}` : undefined
}

/** Tracks Hermes' session-cumulative counters to emit exact per-turn token/cache deltas,
 *  live context size against the model window, and compaction before/after token counts. */
export class TurnUsageTracker {
  private baseline: CumulativeCounters = {}
  private hasBaseline = false
  private lastCalls: number | undefined
  private lastContext: number | undefined
  private lastWindow: number | undefined
  private lastCompressions: number | undefined
  private turnCounters: CumulativeCounters = {}
  private turnContext: number | undefined
  private turnWindow: number | undefined
  private turnCompacted: CompactionSizes | undefined
  private turnSawUsage = false

  constructor(fresh = false) {
    if (fresh) this.seedZero()
  }

  seedZero() {
    this.baseline = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    this.hasBaseline = true
    this.lastCalls = 0
    this.lastCompressions = 0
  }

  seedInfo(info: Record<string, any> | undefined, fresh: boolean): ContextReport | undefined {
    const u = info?.usage
    if (fresh || u?.calls === 0) this.seedZero()
    const used = nonNeg(u?.context_used)
    const window = pos(u?.context_max) ?? pos(info?.context_length)
    const compressions = nonNeg(u?.compressions)
    if (used !== undefined) this.lastContext = used
    else if (fresh) this.lastContext = 0
    if (window !== undefined) this.lastWindow = window
    if (compressions !== undefined) this.lastCompressions = compressions
    if (typeof u?.calls === 'number') this.lastCalls = u.calls
    return contextFromInfo(info, fresh)
  }

  /** Seeds exact live agent cumulative counters from `session.stats`. */
  seedStats(stats: Record<string, any> | undefined): ContextReport | undefined {
    if (!stats || typeof stats !== 'object') return undefined
    const counters: CumulativeCounters = {
      input: nonNeg(stats.input_tokens),
      output: nonNeg(stats.output_tokens),
      cacheRead: nonNeg(stats.cache_read_tokens),
      cacheWrite: nonNeg(stats.cache_write_tokens)
    }
    if (Object.values(counters).some(v => v !== undefined)) {
      this.baseline = counters
      this.hasBaseline = true
    }
    const used = pos(stats.context_tokens) ?? pos(stats.last_prompt_tokens)
    const window = pos(stats.context_length)
    const compressions = nonNeg(stats.compression_count)
    if (used !== undefined) this.lastContext = used
    if (window !== undefined) this.lastWindow = window
    if (compressions !== undefined) this.lastCompressions = compressions
    return reportOf(used, window)
  }

  onTurnStart() {
    this.turnCounters = {}
    this.turnContext = this.turnWindow = this.turnCompacted = undefined
    this.turnSawUsage = false
  }

  onSessionUsage(payload: Record<string, any>): ContextReport | undefined {
    const u = payload.usage
    const input = nonNeg(payload.input_tokens) ?? nonNeg(u?.input)
    const output = nonNeg(payload.output_tokens) ?? nonNeg(u?.output)
    const cacheRead = nonNeg(payload.cache_read_tokens) ?? nonNeg(u?.cache_read)
    const cacheWrite = nonNeg(payload.cache_write_tokens) ?? nonNeg(u?.cache_write)
    const used = pos(payload.context_tokens) ?? pos(u?.context_used) ?? pos(payload.last_prompt_tokens) ?? nonNeg(u?.context_used)
    const window = pos(payload.context_length) ?? pos(u?.context_max)
    const compressions = nonNeg(payload.compression_count) ?? nonNeg(u?.compressions)

    this.noteCompression(compressions, used)
    if (input !== undefined) this.turnCounters.input = input
    if (output !== undefined) this.turnCounters.output = output
    if (cacheRead !== undefined) this.turnCounters.cacheRead = cacheRead
    if (cacheWrite !== undefined) this.turnCounters.cacheWrite = cacheWrite
    if (used !== undefined) this.turnContext = this.lastContext = used
    if (window !== undefined) this.turnWindow = this.lastWindow = window
    if (compressions !== undefined) this.lastCompressions = compressions
    this.turnSawUsage = true
    return reportOf(used, window)
  }

  onComplete(payload: Record<string, any>): { usage?: TurnUsage; contextTokens?: number; compacted?: CompactionSizes; context?: ContextReport } {
    const u = payload.usage && typeof payload.usage === 'object' ? payload.usage : undefined
    const used = nonNeg(u?.context_used) ?? this.turnContext
    const window = pos(u?.context_max) ?? this.turnWindow ?? this.lastWindow
    const compressions = nonNeg(u?.compressions)
    this.noteCompression(compressions, used)

    const merged: CumulativeCounters = {
      input: this.turnCounters.input ?? nonNeg(u?.input),
      output: this.turnCounters.output ?? nonNeg(u?.output),
      cacheRead: this.turnCounters.cacheRead ?? nonNeg(u?.cache_read),
      cacheWrite: this.turnCounters.cacheWrite ?? nonNeg(u?.cache_write)
    }
    const calls = nonNeg(u?.calls)
    const hadCounters = Object.values(merged).some(v => v !== undefined)
    const noCallRan = !this.turnSawUsage && calls !== undefined && this.lastCalls !== undefined && calls === this.lastCalls

    const usage: TurnUsage = {}
    if (this.hasBaseline && hadCounters && !noCallRan) {
      const reset =
        (calls !== undefined && this.lastCalls !== undefined && calls < this.lastCalls) ||
        (['input', 'output', 'cacheRead', 'cacheWrite'] as const).some(k => merged[k] !== undefined && this.baseline[k] !== undefined && merged[k]! < this.baseline[k]!)
      const base = reset ? {} : this.baseline
      const pairs: [keyof TurnUsage, number | undefined][] = [
        ['inputTokens', delta(merged.input, base.input)],
        ['cacheReadTokens', delta(merged.cacheRead, base.cacheRead)],
        ['cacheWriteTokens', delta(merged.cacheWrite, base.cacheWrite)],
        ['outputTokens', delta(merged.output, base.output)]
      ]
      for (const [k, v] of pairs) if (v !== undefined) usage[k] = v
    }
    if (used !== undefined) usage.contextTokens = used
    if (window !== undefined && Object.keys(usage).length > 0) usage.contextWindow = window

    if (hadCounters) {
      this.baseline = {
        input: merged.input ?? this.baseline.input,
        output: merged.output ?? this.baseline.output,
        cacheRead: merged.cacheRead ?? this.baseline.cacheRead,
        cacheWrite: merged.cacheWrite ?? this.baseline.cacheWrite
      }
      this.hasBaseline = true
    }
    if (used !== undefined) this.lastContext = used
    if (window !== undefined) this.lastWindow = window
    if (compressions !== undefined) this.lastCompressions = compressions
    if (calls !== undefined) this.lastCalls = calls

    const compacted = this.turnCompacted && (this.turnCompacted.beforeTokens !== undefined || this.turnCompacted.afterTokens !== undefined) ? { ...this.turnCompacted } : undefined
    this.onTurnStart()
    const context = reportOf(used, window)
    return {
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
      ...(used !== undefined ? { contextTokens: used } : {}),
      ...(compacted ? { compacted } : {}),
      ...(context ? { context } : {})
    }
  }

  private noteCompression(compressions: number | undefined, used: number | undefined) {
    if (compressions !== undefined && this.lastCompressions !== undefined && compressions > this.lastCompressions) {
      this.turnCompacted = { beforeTokens: this.turnCompacted?.beforeTokens ?? this.lastContext, afterTokens: used }
    } else if (this.turnCompacted && this.turnCompacted.afterTokens === undefined && used !== undefined) {
      this.turnCompacted.afterTokens = used
    }
  }
}
