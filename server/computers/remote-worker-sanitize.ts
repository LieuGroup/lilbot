/** Structural boundary validation and sanitization for inbound helper worker frames and outbound worker parameters.
 *  Every field arriving from a remote computer is treated as untrusted text and validated against the shared Zod schema. */
import type { BotModel } from '../../shared/bot-schema'
import type { ChatItem, TurnUsage } from '../../shared/chat-schema'
import { type WorkerAgentInfo, WorkerDoneFrame, type WorkerDoneStatus, type WorkerDriverId, WorkerEventFrame, type WorkerToolEvent } from '../../shared/worker-frame-schema'

const MAX_DONE_ITEMS = 500
const MAX_DONE_TEXT = 500_000
const MAX_ITEM_TEXT = 100_000
const MAX_TOOL_RESULT = 2000
const CLAUDE_MODEL = /^(claude[-_.]|opus$|sonnet$|haiku$)/i
const SAFE_MODEL_CHARS = /^[^\p{Cc}\p{Cf}\s]+$/u

function safeSlice(text: string, max: number): string {
  if (text.length <= max) return text
  let end = Math.max(0, max)
  if (end > 0 && end < text.length) {
    const code = text.charCodeAt(end - 1)
    if (code >= 0xd800 && code <= 0xdbff) end--
  }
  return text.slice(0, end)
}

/** Strips C0/C1 control characters (except tab and newline) and Unicode format characters, then bounds length. */
function cleanRemoteText(text: string, max: number): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip untrusted C0/C1 controls (except tab/newline) and Unicode format chars
  const cleaned = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/gu, '')
  if (cleaned.length <= max) return cleaned
  return max > 14 ? `${safeSlice(cleaned, max - 14)} [truncated]` : safeSlice(cleaned, max)
}

/** Single-line cleaner: strips every control and Unicode format character, trims, and bounds length. */
function cleanRemoteLine(text: string, max: number): string {
  const cleaned = text.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
  if (cleaned.length <= max) return cleaned
  return max > 14 ? `${safeSlice(cleaned, max - 14)} [truncated]` : safeSlice(cleaned, max)
}

/** Maps a remote coding agent's tool name to LilBot's fixed worker activity labels (never echoes raw agent text). */
export function remoteToolActivity(tool?: string): string {
  if (!tool) return 'Working'
  const lower = tool.toLowerCase()
  if (/^(bash|shell|terminal|exec)$|terminal|exec|shell|command/.test(lower)) return 'Running commands'
  if (/^(read|edit|write|multiedit|glob|grep|ls|notebookedit)$|read|file|patch|edit|glob|grep/.test(lower)) return 'Working with files'
  if (/^(websearch|webfetch)$|search|browse|web|fetch/.test(lower)) return 'Searching the web'
  if (/memory|recall/.test(lower)) return 'Updating memory'
  return 'Using a tool'
}

export interface SanitizedWorkerEvent {
  runId: string
  sessionId?: string
  tools: WorkerToolEvent[]
  activity?: string
}

/** Validates and cleans an inbound `worker.event` frame. Never forwards raw untrusted `activity` text into the UI. */
export function sanitizeWorkerEvent(raw: unknown): SanitizedWorkerEvent | null {
  const parsed = WorkerEventFrame.safeParse(raw)
  if (!parsed.success) return null
  const frame = parsed.data
  const tools: WorkerToolEvent[] = []
  for (const t of frame.tools ?? []) {
    if (tools.length >= 32) break
    const toolId = cleanRemoteLine(t.toolId, 200)
    const name = cleanRemoteLine(t.name, 200)
    if (!toolId || !name) continue
    tools.push({ toolId, name, detail: cleanRemoteLine(t.detail, 500), running: t.running, ...(t.failed ? { failed: true } : {}) })
  }
  const latestRunning = [...tools].reverse().find(t => t.running)
  const activity = latestRunning ? remoteToolActivity(latestRunning.name) : frame.activity ? 'Working' : undefined
  return {
    runId: frame.runId,
    ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
    tools,
    ...(activity ? { activity } : {})
  }
}

export interface SanitizedWorkerDone {
  runId: string
  sessionId?: string
  status: WorkerDoneStatus
  text: string
  items: ChatItem[]
  usage?: TurnUsage
  error?: string
}

/** Validates and sanitizes an inbound `worker.done` frame. Whitelists only `assistant` and `tool` items (dropping
 *  `user`, `compaction`, `error`, and `connection.sign_in`) and strips `threadId`/`workItemId` from tool items. */
export function sanitizeWorkerDone(raw: unknown): SanitizedWorkerDone | null {
  const parsed = WorkerDoneFrame.safeParse(raw)
  if (!parsed.success) return null
  const frame = parsed.data
  const items: ChatItem[] = []
  let assistantBudget = MAX_DONE_TEXT
  for (const item of frame.items) {
    if (items.length >= MAX_DONE_ITEMS) break
    if (item.kind === 'assistant') {
      if (assistantBudget <= 0) continue
      const text = cleanRemoteText(item.text, Math.min(MAX_ITEM_TEXT, assistantBudget))
      if (!text) continue
      assistantBudget -= text.length
      items.push({ kind: 'assistant', text, ...(item.stopped ? { stopped: true } : {}) })
    } else if (item.kind === 'tool') {
      const toolId = cleanRemoteLine(item.toolId, 200)
      const name = cleanRemoteLine(item.name, 200)
      if (!toolId || !name) continue
      const result = item.result ? cleanRemoteText(item.result, MAX_TOOL_RESULT) : undefined
      items.push({
        kind: 'tool',
        toolId,
        name,
        detail: cleanRemoteLine(item.detail, 500),
        running: false,
        ...(item.failed ? { failed: true } : {}),
        ...(result ? { result } : {})
      })
    }
  }
  const text = cleanRemoteText(frame.text, MAX_DONE_TEXT)
  const error = frame.error ? cleanRemoteLine(frame.error, 500) : undefined
  return {
    runId: frame.runId,
    ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
    status: frame.status,
    text,
    items,
    ...(frame.usage ? { usage: frame.usage } : {}),
    ...(error ? { error } : {})
  }
}

/** Validates a remote working directory: absolute (`/…`) or home-relative (`~` / `~/…`), bounded, no control/format chars. */
export function validateRemoteCwd(cwd: string): { ok: true; cwd: string } | { ok: false; message: string } {
  if (!cwd || cwd.length > 4096) return { ok: false, message: 'Folder path (cwd) must be between 1 and 4096 characters.' }
  if (/[\p{Cc}\p{Cf}]/u.test(cwd)) return { ok: false, message: 'Folder path (cwd) cannot contain control or invisible formatting characters.' }
  if (cwd.trim() !== cwd) return { ok: false, message: 'Folder path (cwd) cannot start or end with whitespace.' }
  if (cwd !== '~' && !cwd.startsWith('~/') && !cwd.startsWith('/')) return { ok: false, message: 'Folder path (cwd) must be absolute (/...) or home-relative (~/...).' }
  return { ok: true, cwd }
}

/** Validates a requested model against a computer's advertised coding agents. Fails fast when incompatible. */
export function validateRemoteModel(
  model: BotModel | null | undefined,
  agents: WorkerAgentInfo[]
): { ok: true; driver: WorkerDriverId; wireModel: string } | { ok: false; message: string } {
  if (!agents.length) return { ok: false, message: 'That computer does not advertise a coding agent.' }
  const raw = model?.model?.trim() ?? ''
  if (!raw) return { ok: false, message: 'Specify a model for this remote worker (no default model is set for remote computers).' }
  if (raw.length > 200 || !SAFE_MODEL_CHARS.test(raw) || raw.startsWith('-')) return { ok: false, message: `Model "${cleanRemoteLine(raw, 80)}" is not a valid remote model name.` }
  const claude = agents.find(agent => agent.driver === 'claude-code')
  if (claude) {
    let wireModel = raw
    if (raw.includes('/')) {
      if (!raw.toLowerCase().startsWith('anthropic/')) return { ok: false, message: `Model "${raw}" cannot run on that computer's claude-code agent (Claude models only).` }
      wireModel = raw.slice('anthropic/'.length)
    }
    if (!wireModel || wireModel.startsWith('-') || !CLAUDE_MODEL.test(wireModel))
      return { ok: false, message: `Model "${raw}" cannot run on that computer's claude-code agent (Claude models only).` }
    return { ok: true, driver: 'claude-code', wireModel }
  }
  return { ok: false, message: `Unsupported coding agent on that computer.` }
}
