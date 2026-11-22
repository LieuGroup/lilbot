/** Claude Code CLI flags and stream-json NDJSON parser: all CLI flag and stream parsing in one small file. */
import type { ChatItem, TurnUsage } from '../shared/chat-schema'
import type { WorkerToolEvent } from '../shared/worker-frame-schema'
import type { WorkerProgressEvent, WorkerStartRequest } from './worker-driver'

export const cleanAgentText = (text: string, max: number, secret?: string) => {
  let out = secret ? text.replaceAll(secret, '[redacted]') : text
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip non-printable control chars from untrusted agent output
  out = out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  return out.length > max ? `${out.slice(0, max - 14)} [truncated]` : out
}

export const claudeUserLine = (text: string) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`

export function buildClaudeArgs(request: WorkerStartRequest, mcpConfigPath: string): string[] {
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
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  const value = obj.file_path ?? obj.path ?? obj.command ?? obj.pattern ?? obj.query ?? obj.url ?? ''
  return typeof value === 'string' ? cleanAgentText(value, 300, secret) : ''
}

function blockText(content: unknown, secret?: string): string {
  if (typeof content === 'string') return cleanAgentText(content, 2000, secret)
  if (!Array.isArray(content)) return ''
  return cleanAgentText(
    content.map(part => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('\n'),
    2000,
    secret
  )
}

function parseUsage(raw: Record<string, unknown>, modelUsage: unknown): TurnUsage | undefined {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined)
  const usage: TurnUsage = {
    inputTokens: num(raw.input_tokens),
    cacheReadTokens: num(raw.cache_read_input_tokens),
    cacheWriteTokens: num(raw.cache_creation_input_tokens),
    outputTokens: num(raw.output_tokens)
  }
  if (modelUsage && typeof modelUsage === 'object') {
    const first = Object.values(modelUsage as Record<string, unknown>).find(v => v && typeof v === 'object') as Record<string, unknown> | undefined
    const win = num(first?.contextWindow)
    if (win && win > 0) usage.contextWindow = win
  }
  return Object.values(usage).some(v => v !== undefined) ? usage : undefined
}

export function parseClaudeLine(line: string, state: ClaudeStreamState, secret?: string): WorkerProgressEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof msg.session_id === 'string' && msg.session_id.length <= 200) state.sessionId = msg.session_id
  if (msg.type === 'system') return { sessionId: state.sessionId, ...(msg.subtype === 'init' ? { activity: 'Starting...' } : {}) }
  if (msg.type === 'rate_limit_event') return { sessionId: state.sessionId, activity: 'Waiting for rate limit...' }
  if (msg.type === 'assistant') {
    if (typeof msg.error === 'string' && msg.error.trim()) state.resultError = cleanAgentText(msg.error.trim(), 1000, secret)
    const blocks = Array.isArray((msg.message as { content?: unknown } | undefined)?.content) ? ((msg.message as { content: unknown[] }).content as Record<string, unknown>[]) : []
    const tools: WorkerToolEvent[] = []
    let activity: string | undefined
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        const text = cleanAgentText(block.text, 100_000, secret)
        state.text = state.text ? `${state.text}\n${text}` : text
        if (state.items.length < 500) state.items.push({ kind: 'assistant', text })
      } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        const name = cleanAgentText(block.name, 200, secret)
        const detail = toolDetail(block.input, secret)
        const item: Extract<ChatItem, { kind: 'tool' }> = { kind: 'tool', toolId: cleanAgentText(block.id, 200, secret), name, detail, running: true }
        state.tools.set(item.toolId, item)
        if (state.items.length < 500) state.items.push(item)
        tools.push({ toolId: item.toolId, name, detail, running: true })
        activity = cleanAgentText(detail ? `${name}: ${detail}` : name, 240, secret)
      } else if (block.type === 'thinking') activity ??= 'Thinking...'
    }
    return {
      sessionId: state.sessionId,
      ...(activity ? { activity } : {}),
      ...(tools.length ? { tools } : {}),
      ...(state.text ? { textPreview: state.text.slice(-3900) } : {})
    }
  }
  if (msg.type === 'user') {
    const blocks = Array.isArray((msg.message as { content?: unknown } | undefined)?.content) ? ((msg.message as { content: unknown[] }).content as Record<string, unknown>[]) : []
    const tools: WorkerToolEvent[] = []
    for (const block of blocks) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const item = state.tools.get(block.tool_use_id)
      if (!item) continue
      item.running = false
      item.failed = Boolean(block.is_error)
      const result = blockText(block.content, secret)
      if (result) item.result = result
      tools.push({ toolId: item.toolId, name: item.name, detail: item.detail, running: false, failed: item.failed })
    }
    return tools.length ? { sessionId: state.sessionId, tools } : null
  }
  if (msg.type === 'result') {
    state.resultSeen = true
    if (msg.usage && typeof msg.usage === 'object') state.usage = parseUsage(msg.usage as Record<string, unknown>, msg.modelUsage)
    const isError = Boolean(msg.is_error) || (typeof msg.subtype === 'string' && msg.subtype.startsWith('error'))
    if (isError) {
      const firstErr = Array.isArray(msg.errors) && typeof msg.errors[0] === 'string' ? msg.errors[0] : undefined
      state.resultError = cleanAgentText(String(msg.result || firstErr || 'Worker failed.'), 1000, secret)
    } else if (typeof msg.result === 'string' && msg.result) state.resultText = cleanAgentText(msg.result, 500_000, secret)
    return { sessionId: state.sessionId, ...(state.resultText ? { textPreview: state.resultText.slice(-3900) } : {}) }
  }
  return null
}
