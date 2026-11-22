/** Pure formatting and view-model helpers for per-turn token counts, bot context size and compaction lines (Paper "21 Message cost and context size"). */
import type { BotContext } from '../../../shared/bot-schema'
import type { ChatItem, TurnUsage } from '../../../shared/chat-schema'

export type UsageBucketKey = 'cacheRead' | 'cacheWrite' | 'input' | 'output'

interface UsageRow {
  key: UsageBucketKey
  label: string
  value: number
  text: string
  muted: boolean
}

export interface TurnUsageView {
  empty: boolean
  hasBreakdown: boolean
  emptyNote: string | null
  totalLabel: string | null
  rows: UsageRow[]
  segments: UsageRow[]
  contextAfter: string | null
}

interface ContextMeterView {
  label: string
  ratio: number | null
  muted: boolean
}

interface ContextDetailView {
  empty: boolean
  percentLabel: string | null
  barValue: number | null
  countLine: string
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** Whole token count with English thousands separators: "187,620". */
export function formatTokenCount(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** Compact count for the composer meter when the model's context limit is unknown: "187k", "1.5k", "850". */
export function formatCompactTokens(n: number): string {
  const value = Math.max(0, Math.round(n))
  if (value < 1_000) return String(value)
  if (value < 10_000) return `${(Math.floor(value / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
  if (value < 1_000_000) return `${Math.floor(value / 1_000)}k`
  return `${(Math.floor(value / 100_000) / 10).toFixed(1).replace(/\.0$/, '')}M`
}

const pctText = (used: number, window: number) => {
  const pct = Math.round((used / window) * 100)
  return used > 0 && pct === 0 ? '<1%' : `${pct}%`
}

/** Compact ring and label for the composer pill: a dash until the first turn reports a size, percentage against the window, or compact count when the limit is unknown. */
export function contextMeterView(context: BotContext | undefined): ContextMeterView {
  if (!context || context.used === 0) return { label: '–', ratio: null, muted: true }
  if (context.window !== null) {
    return { label: pctText(context.used, context.window), ratio: Math.min(1, Math.max(0, context.used / context.window)), muted: false }
  }
  return { label: formatCompactTokens(context.used), ratio: null, muted: false }
}

/** Expanded context details for the composer popover/sheet and the Setup panel card. */
export function contextDetailView(context: BotContext | undefined): ContextDetailView {
  if (!context) return { empty: true, percentLabel: null, barValue: null, countLine: 'No size reported yet.' }
  if (context.window !== null) {
    return {
      empty: false,
      percentLabel: `${pctText(context.used, context.window)} used`,
      barValue: Math.min(100, Math.max(0, (context.used / context.window) * 100)),
      countLine: `${formatTokenCount(context.used)} of ${formatTokenCount(context.window)} tokens`
    }
  }
  return {
    empty: false,
    percentLabel: null,
    barValue: null,
    countLine: `${formatTokenCount(context.used)} ${plural(context.used, 'token', 'tokens')}`
  }
}

/** Breakdown for one assistant turn's popover or mobile sheet. Zero and unreported buckets stay muted and leave the segmented bar. */
export function turnUsageView(usage: TurnUsage | undefined): TurnUsageView {
  const buckets: { key: UsageBucketKey; label: string; count: number | undefined }[] = [
    { key: 'cacheRead', label: 'Read from cache', count: usage?.cacheReadTokens },
    { key: 'cacheWrite', label: 'Written to cache', count: usage?.cacheWriteTokens },
    { key: 'input', label: 'New input', count: usage?.inputTokens },
    { key: 'output', label: 'Output', count: usage?.outputTokens }
  ]
  const hasBreakdown = buckets.some(bucket => bucket.count !== undefined)
  const total = buckets.reduce((sum, bucket) => sum + (bucket.count ?? 0), 0)
  const rows: UsageRow[] = buckets.map(bucket => ({
    key: bucket.key,
    label: bucket.label,
    value: bucket.count ?? 0,
    text: bucket.count === undefined ? '–' : formatTokenCount(bucket.count),
    muted: !bucket.count
  }))
  const contextAfter =
    usage?.contextTokens !== undefined
      ? usage.contextWindow !== undefined
        ? `${formatTokenCount(usage.contextTokens)} of ${formatTokenCount(usage.contextWindow)}`
        : `${formatTokenCount(usage.contextTokens)} ${plural(usage.contextTokens, 'token', 'tokens')}`
      : null
  const empty = !hasBreakdown && contextAfter === null
  const emptyNote = hasBreakdown ? null : empty ? 'No numbers were recorded for this turn.' : 'Token breakdown was not recorded for this turn.'
  return {
    empty,
    hasBreakdown,
    emptyNote,
    totalLabel: hasBreakdown ? `${formatTokenCount(total)} ${plural(total, 'token', 'tokens')}` : null,
    rows,
    segments: rows.filter(row => row.value > 0),
    contextAfter
  }
}

/** One line where the engine shortened the conversation (Frame 3). */
export function compactionLineText(item: Pick<Extract<ChatItem, { kind: 'compaction' }>, 'beforeTokens' | 'afterTokens' | 'compactedMessages'>): string {
  if (item.beforeTokens !== undefined && item.afterTokens !== undefined) {
    return `Conversation shortened · ${formatTokenCount(item.beforeTokens)} to ${formatTokenCount(item.afterTokens)} tokens`
  }
  if (item.afterTokens !== undefined) return `Conversation shortened · to ${formatTokenCount(item.afterTokens)} ${plural(item.afterTokens, 'token', 'tokens')}`
  if (item.compactedMessages !== undefined && item.compactedMessages > 0) {
    return `Conversation shortened · ${formatTokenCount(item.compactedMessages)} ${plural(item.compactedMessages, 'message', 'messages')}`
  }
  return 'Conversation shortened'
}
