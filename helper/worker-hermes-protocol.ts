/** Pure Hermes canonical-gateway event streaming, usage deltas, and transcript mapping for the helper driver. */
import type { ChatItem, TurnUsage } from '../shared/chat-schema'
import type { WorkerToolEvent } from '../shared/worker-frame-schema'
import type { WorkerProgressEvent } from './worker-driver'
import { cleanHermesError, stripEditorMcpPrefix } from './worker-hermes-model'
import type { HermesGatewayEvent } from './worker-hermes-socket'
import { cleanAgentLine, cleanAgentText } from './worker-text'

const MAX_ITEMS = 500
const MAX_TEXT = 500_000

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const nonNeg = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined)
const pos = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined)
const delta = (curr: number | undefined, prev: number | undefined) => (curr === undefined ? undefined : prev === undefined || curr < prev ? curr : curr - prev)

function hermesToolFailed(result: unknown): boolean {
  let value = result
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return false
    }
  }
  if (!isRecord(value)) return false
  return (
    value.success === false || value.ok === false || (typeof value.error === 'string' && value.error.length > 0) || (typeof value.exit_code === 'number' && value.exit_code !== 0)
  )
}

interface UsageBaseline {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface HermesStreamState {
  sessionId?: string
  items: ChatItem[]
  tools: Map<string, Extract<ChatItem, { kind: 'tool' }>>
  text: string
  baseline: UsageBaseline
  hasBaseline: boolean
  turnCounters: UsageBaseline
  contextTokens?: number
  contextWindow?: number
  usage?: TurnUsage
  complete?: { status: 'completed' | 'stopped' | 'failed'; text: string; error?: string }
}

export const createHermesStreamState = (sessionId?: string): HermesStreamState => ({
  ...(sessionId ? { sessionId } : {}),
  items: [],
  tools: new Map(),
  text: '',
  baseline: {},
  hasBaseline: false,
  turnCounters: {}
})

export function seedHermesUsage(state: HermesStreamState, stats: Record<string, any> | undefined, fresh: boolean) {
  if (fresh) {
    state.baseline = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    state.hasBaseline = true
  }
  if (!stats || typeof stats !== 'object') return
  const counters: UsageBaseline = {
    input: nonNeg(stats.input_tokens),
    output: nonNeg(stats.output_tokens),
    cacheRead: nonNeg(stats.cache_read_tokens),
    cacheWrite: nonNeg(stats.cache_write_tokens)
  }
  if (Object.values(counters).some(v => v !== undefined)) {
    state.baseline = counters
    state.hasBaseline = true
  }
  state.contextWindow = pos(stats.context_length) ?? state.contextWindow
}

function finalizeUsage(state: HermesStreamState, payloadUsage: unknown): TurnUsage | undefined {
  const u = isRecord(payloadUsage) ? payloadUsage : undefined
  const merged: UsageBaseline = {
    input: nonNeg(u?.input) ?? state.turnCounters.input,
    output: nonNeg(u?.output) ?? state.turnCounters.output,
    cacheRead: nonNeg(u?.cache_read) ?? state.turnCounters.cacheRead,
    cacheWrite: nonNeg(u?.cache_write) ?? state.turnCounters.cacheWrite
  }
  const inputTokens = state.hasBaseline ? delta(merged.input, state.baseline.input) : merged.input
  const outputTokens = state.hasBaseline ? delta(merged.output, state.baseline.output) : merged.output
  const cacheReadTokens = state.hasBaseline ? delta(merged.cacheRead, state.baseline.cacheRead) : merged.cacheRead
  const cacheWriteTokens = state.hasBaseline ? delta(merged.cacheWrite, state.baseline.cacheWrite) : merged.cacheWrite
  const contextTokens = nonNeg(u?.context_used) ?? state.contextTokens
  const contextWindow = pos(u?.context_max) ?? state.contextWindow
  const out: TurnUsage = {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {})
  }
  return Object.values(out).some(v => v !== undefined) ? out : undefined
}

function toolDetailFromStart(payload: Record<string, any>, secret?: string): string {
  if (typeof payload.context === 'string' && payload.context.trim()) return cleanAgentLine(payload.context, 300, secret)
  if (!isRecord(payload.args)) return ''
  const raw = payload.args.path ?? payload.args.file_path ?? payload.args.command ?? payload.args.query ?? payload.args.url ?? ''
  return typeof raw === 'string' ? cleanAgentLine(raw, 300, secret) : ''
}

export function applyHermesEvent(state: HermesStreamState, event: HermesGatewayEvent, secret?: string): WorkerProgressEvent | null {
  const { type, payload } = event
  if (type === 'thinking.delta') return { ...(state.sessionId ? { sessionId: state.sessionId } : {}), activity: 'Thinking...' }
  if (type === 'message.delta' || type === 'message.interim') {
    const chunk = typeof payload.text === 'string' ? cleanAgentText(payload.text, 100_000, secret) : ''
    if (!chunk) return null
    const sep = type === 'message.interim' && state.text && !state.text.endsWith('\n') ? '\n' : ''
    if (state.text.length < MAX_TEXT) {
      const next = `${state.text}${sep}${chunk}`
      state.text = next.length > MAX_TEXT ? `${next.slice(0, MAX_TEXT - 14)} [truncated]` : next
    }
    return { ...(state.sessionId ? { sessionId: state.sessionId } : {}), textPreview: state.text.slice(-3900) }
  }
  if (type === 'tool.start') {
    const toolId = cleanAgentLine(typeof payload.tool_id === 'string' ? payload.tool_id : '', 200, secret)
    const name = cleanAgentLine(stripEditorMcpPrefix(typeof payload.name === 'string' ? payload.name : 'tool'), 200, secret) || 'tool'
    if (!toolId) return null
    const detail = toolDetailFromStart(payload, secret)
    const item: Extract<ChatItem, { kind: 'tool' }> = { kind: 'tool', toolId, name, detail, running: true }
    if (state.items.length < MAX_ITEMS && state.tools.size < MAX_ITEMS) {
      state.tools.set(toolId, item)
      state.items.push(item)
    }
    const toolEv: WorkerToolEvent = { toolId, name, detail, running: true }
    return { ...(state.sessionId ? { sessionId: state.sessionId } : {}), activity: cleanAgentLine(detail ? `${name}: ${detail}` : name, 240, secret), tools: [toolEv] }
  }
  if (type === 'tool.complete') {
    const toolId = cleanAgentLine(typeof payload.tool_id === 'string' ? payload.tool_id : '', 200, secret)
    const item = state.tools.get(toolId)
    if (!item) return null
    item.running = false
    item.failed = hermesToolFailed(payload.result)
    if (payload.result !== undefined && payload.result !== null) {
      const raw = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result)
      const res = cleanAgentText(raw, 2000, secret)
      if (res) item.result = res
    }
    return {
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      tools: [{ toolId: item.toolId, name: item.name, detail: item.detail, running: false, failed: item.failed }]
    }
  }
  if (type === 'session.usage') {
    const u = isRecord(payload.usage) ? payload.usage : undefined
    state.turnCounters.input = nonNeg(payload.input_tokens) ?? nonNeg(u?.input) ?? state.turnCounters.input
    state.turnCounters.output = nonNeg(payload.output_tokens) ?? nonNeg(u?.output) ?? state.turnCounters.output
    state.turnCounters.cacheRead = nonNeg(payload.cache_read_tokens) ?? nonNeg(u?.cache_read) ?? state.turnCounters.cacheRead
    state.turnCounters.cacheWrite = nonNeg(payload.cache_write_tokens) ?? nonNeg(u?.cache_write) ?? state.turnCounters.cacheWrite
    state.contextTokens = pos(payload.context_tokens) ?? pos(u?.context_used) ?? pos(payload.last_prompt_tokens) ?? state.contextTokens
    state.contextWindow = pos(payload.context_length) ?? pos(u?.context_max) ?? state.contextWindow
    return null
  }
  if (type === 'message.complete') {
    state.usage = finalizeUsage(state, payload.usage)
    const status = payload.status === 'interrupted' ? 'stopped' : payload.status === 'error' ? 'failed' : 'completed'
    const text = cleanAgentText(typeof payload.text === 'string' && payload.text ? payload.text : state.text, MAX_TEXT, secret)
    const rawErr = typeof payload.error === 'string' && payload.error ? payload.error : status === 'failed' ? text || 'Hermes worker failed.' : undefined
    state.complete = { status, text: status === 'failed' ? '' : text, ...(rawErr ? { error: cleanHermesError(rawErr, secret) } : {}) }
    return text && status !== 'failed' ? { ...(state.sessionId ? { sessionId: state.sessionId } : {}), textPreview: text.slice(-3900) } : null
  }
  return null
}

/** Maps Hermes `display_messages` rows (starting at `startIndex` on resumes) to clean helper `ChatItem[]`. */
export function mapHermesTranscript(rows: unknown, startIndex: number, secret?: string): ChatItem[] {
  if (!Array.isArray(rows)) return []
  const items: ChatItem[] = []
  for (const row of rows.slice(Math.max(0, startIndex))) {
    if (items.length >= MAX_ITEMS || !isRecord(row)) continue
    if (row.role === 'assistant' && typeof row.text === 'string') {
      const body = cleanAgentText(row.text, 100_000, secret)
      if (body) items.push({ kind: 'assistant', text: body })
    } else if (row.role === 'tool') {
      const toolId = cleanAgentLine(typeof row.tool_call_id === 'string' && row.tool_call_id ? row.tool_call_id : `hermes-${items.length}`, 200, secret)
      const name = cleanAgentLine(stripEditorMcpPrefix(typeof row.name === 'string' ? row.name : 'tool'), 200, secret) || 'tool'
      const detail = cleanAgentLine(typeof row.context === 'string' ? row.context : '', 300, secret)
      const raw = row.content == null ? undefined : typeof row.content === 'string' ? row.content : JSON.stringify(row.content)
      const result = raw ? cleanAgentText(raw, 2000, secret) : undefined
      items.push({ kind: 'tool', toolId, name, detail, running: false, ...(row.content == null ? {} : { failed: hermesToolFailed(row.content) }), ...(result ? { result } : {}) })
    }
  }
  return items
}
