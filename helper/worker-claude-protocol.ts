/** Claude Code CLI flags and stream-json NDJSON parser: all CLI flag and stream parsing in one small file. */
import type { ChatItem, TurnUsage } from '../shared/chat-schema'
import { SAFE_WORKER_SESSION_ID, WORKER_SYSTEM_PROMPT_MAX_BYTES, type WorkerToolEvent } from '../shared/worker-frame-schema'
import type { WorkerProgressEvent, WorkerStartRequest } from './worker-driver'

const MAX_ITEMS = 500
const MAX_TEXT = 500_000
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

export const cleanAgentText = (text: string, max: number, secret?: string) => {
  let out = secret ? text.replaceAll(secret, '[redacted]') : text
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip C0/C1 control characters from untrusted agent output
  out = out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
  return out.length > max ? `${out.slice(0, max - 14)} [truncated]` : out
}

export const claudeUserLine = (text: string) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`

export function buildClaudeArgs(request: WorkerStartRequest, mcpConfigPath: string): string[] {
  if (request.model.startsWith('-')) throw new Error('Invalid model name.')
  if (request.reasoningEffort?.startsWith('-')) throw new Error('Invalid reasoning effort.')
  if (request.sessionId && !SAFE_WORKER_SESSION_ID.test(request.sessionId)) throw new Error('Invalid session id.')
  if (request.systemPrompt && Buffer.byteLength(request.systemPrompt, 'utf8') > WORKER_SYSTEM_PROMPT_MAX_BYTES) throw new Error('System prompt exceeds byte limit.')
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfigPath,
    '--model',
    request.model
  ]
  if (request.reasoningEffort) args.push('--effort', request.reasoningEffort)
  if (request.systemPrompt) args.push('--append-system-prompt', request.systemPrompt)
  if (request.sessionId) args.push('--resume', request.sessionId)
  return args
}

export interface ClaudeStreamState {
  sessionId?: string
  items: ChatItem[]
  tools: Map<string, Extract<ChatItem, { kind: 'tool' }>>
  text: string
  resultText?: string
  resultSeen: boolean
  resultError?: string
  usage?: TurnUsage
}

export const createClaudeStreamState = (): ClaudeStreamState => ({ items: [], tools: new Map(), text: '', resultSeen: false })

function toolDetail(input: unknown, secret?: string): string {
  if (!isRecord(input)) return ''
  const value = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.query ?? input.url ?? ''
  return typeof value === 'string' ? cleanAgentText(value, 300, secret) : ''
}

function blockText(content: unknown, secret?: string): string {
  if (typeof content === 'string') return cleanAgentText(content, 2000, secret)
  if (!Array.isArray(content)) return ''
  return cleanAgentText(content.map(part => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('\n'), 2000, secret)
}

function parseUsage(raw: unknown, modelUsage: unknown): TurnUsage | undefined {
  if (!isRecord(raw)) return undefined
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined)
  const usage: TurnUsage = {
    inputTokens: num(raw.input_tokens),
    cacheReadTokens: num(raw.cache_read_input_tokens),
    cacheWriteTokens: num(raw.cache_creation_input_tokens),
    outputTokens: num(raw.output_tokens)
  }
  if (isRecord(modelUsage)) {
    const first = Object.values(modelUsage).find(isRecord)
    const win = num(first?.contextWindow)
    if (win && win > 0) usage.contextWindow = win
  }
  return Object.values(usage).some(v => v !== undefined) ? usage : undefined
}

const contentBlocks = (msg: Record<string, unknown>) => (isRecord(msg.message) && Array.isArray(msg.message.content) ? msg.message.content.filter(isRecord) : [])

export function parseClaudeLine(line: string, state: ClaudeStreamState, secret?: string): WorkerProgressEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const msg = parsed
  if (typeof msg.session_id === 'string' && SAFE_WORKER_SESSION_ID.test(msg.session_id) && (!secret || !msg.session_id.includes(secret))) state.sessionId = msg.session_id
  if (msg.type === 'system') return { ...(state.sessionId ? { sessionId: state.sessionId } : {}), ...(msg.subtype === 'init' ? { activity: 'Starting...' } : {}) }
  if (msg.type === 'rate_limit_event') return { ...(state.sessionId ? { sessionId: state.sessionId } : {}), activity: 'Waiting for rate limit...' }
  if (msg.type === 'assistant') {
    if (typeof msg.error === 'string' && msg.error.trim()) state.resultError = cleanAgentText(msg.error.trim(), 1000, secret)
    const tools: WorkerToolEvent[] = []
    let activity: string | undefined
    for (const block of contentBlocks(msg)) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const text = cleanAgentText(block.text, 100_000, secret)
        if (!text) continue
        if (state.text.length < MAX_TEXT) {
          const joined = state.text ? `${state.text}\n${text}` : text
          state.text = joined.length > MAX_TEXT ? `${joined.slice(0, MAX_TEXT - 14)} [truncated]` : joined
        }
        if (state.items.length < MAX_ITEMS) state.items.push({ kind: 'assistant', text })
      } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        const toolId = cleanAgentText(block.id, 200, secret).trim()
        const name = cleanAgentText(block.name, 200, secret).trim()
        if (!toolId || !name) continue
        const detail = toolDetail(block.input, secret)
        const item: Extract<ChatItem, { kind: 'tool' }> = { kind: 'tool', toolId, name, detail, running: true }
        if (state.items.length < MAX_ITEMS && state.tools.size < MAX_ITEMS) {
          state.tools.set(toolId, item)
          state.items.push(item)
        }
        if (tools.length < 32) tools.push({ toolId, name, detail, running: true })
        activity = cleanAgentText(detail ? `${name}: ${detail}` : name, 240, secret).trim() || undefined
      } else if (block.type === 'thinking') activity ??= 'Thinking...'
    }
    if (!state.sessionId && !activity && !tools.length && !state.text) return null
    return {
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      ...(activity ? { activity } : {}),
      ...(tools.length ? { tools } : {}),
      ...(state.text ? { textPreview: state.text.slice(-3900) } : {})
    }
  }
  if (msg.type === 'user') {
    const tools: WorkerToolEvent[] = []
    for (const block of contentBlocks(msg)) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const item = state.tools.get(cleanAgentText(block.tool_use_id, 200, secret).trim())
      if (!item) continue
      item.running = false
      item.failed = Boolean(block.is_error)
      const result = blockText(block.content, secret)
      if (result) item.result = result
      if (tools.length < 32) tools.push({ toolId: item.toolId, name: item.name, detail: item.detail, running: false, failed: item.failed })
    }
    return tools.length ? { ...(state.sessionId ? { sessionId: state.sessionId } : {}), tools } : null
  }
  if (msg.type === 'result') {
    state.resultSeen = true
    state.usage = parseUsage(msg.usage, msg.modelUsage)
    const isError = Boolean(msg.is_error) || (typeof msg.subtype === 'string' && msg.subtype.startsWith('error'))
    if (isError) {
      const firstErr = Array.isArray(msg.errors) && typeof msg.errors[0] === 'string' ? msg.errors[0] : undefined
      state.resultError = cleanAgentText(String(msg.result || firstErr || 'Worker failed.'), 1000, secret)
    } else if (typeof msg.result === 'string' && msg.result) state.resultText = cleanAgentText(msg.result, MAX_TEXT, secret)
    return { ...(state.sessionId ? { sessionId: state.sessionId } : {}), ...(state.resultText ? { textPreview: state.resultText.slice(-3900) } : {}) }
  }
  return null
}
