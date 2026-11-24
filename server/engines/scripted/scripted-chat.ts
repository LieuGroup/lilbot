/** Session state, streaming turn execution, OpenChat handle, and history source for the scripted engine. */
import type { ChatEvent, ChatItem, TurnUsage } from '../../../shared/chat-schema'
import { LilBotError } from '../../../shared/lilbot-error'
import type { ChatOptions, ConversationSource, EngineAttachment, OpenChat, RoutineOptions, TurnOrigin } from '../bot-engine'
import type { McpCallResult } from './scripted-mcp'
import { awaitWithDisconnect } from './scripted-routines'

export type ResumeOutcome = 'ok' | 'not_found' | Error

export interface ScriptedInput {
  text: string
  apiText?: string
  origin?: TurnOrigin
  attachments?: EngineAttachment[]
  hidden?: boolean
  inputId?: string
}

interface ScriptedRow {
  id: string
  at: number
  order: number
  item: ChatItem
}

export interface ScriptedSession {
  chatId: string
  nativeId: string
  workspace: string
  hidden: boolean
  createdAt: number
  title: string
  running: boolean
  items: ChatItem[]
  rows: ScriptedRow[]
  inputs: ScriptedInput[]
  seenInputIds: Set<string>
  controller: AbortController | null
  routineOptions?: RoutineOptions
  /** Tool names discovered on a review session's narrow MCP connection. */
  reviewTools?: string[]
  emit?: (event: ChatEvent) => void
}

export interface ScriptedTurnContext {
  nativeId: string
  chatId: string
  workspace: string
  input: ScriptedInput
  hidden: boolean
  signal: AbortSignal
  emitDelta: (text: string) => void
  callMcp: (tool: string, args?: Record<string, unknown>, server?: string) => Promise<McpCallResult>
  /** Populated on review sessions: the exact tool names advertised by the review MCP server. */
  reviewTools?: string[]
}

export type ScriptedTurnHandler = (ctx: ScriptedTurnContext) => Promise<string | { text: string; status?: 'completed' | 'stopped' | 'failed'; usage?: TurnUsage }>

const DEFAULT_USAGE: TurnUsage = { inputTokens: 12, outputTokens: 8, contextTokens: 20, contextWindow: 8192 }

function appendRow(session: ScriptedSession, item: ChatItem, rowId = crypto.randomUUID()): string {
  session.items.push(item)
  session.rows.push({ id: rowId, at: Date.now(), order: session.rows.length, item })
  return rowId
}

export function newSession(chatId: string, nativeId: string, workspace: string, hidden: boolean, createdAt: number): ScriptedSession {
  return { chatId, nativeId, workspace, hidden, createdAt, title: '', running: false, items: [], rows: [], inputs: [], seenInputIds: new Set(), controller: null }
}

export async function runScriptedTurn(
  session: ScriptedSession,
  input: ScriptedInput,
  callMcp: ScriptedTurnContext['callMcp'],
  handler: ScriptedTurnHandler | undefined
): Promise<{ status: 'completed' | 'stopped' | 'failed'; text: string }> {
  session.inputs.push(input)
  if (!input.hidden) appendRow(session, { kind: 'user', text: input.text, messageId: input.inputId })
  const controller = new AbortController()
  session.controller = controller
  session.running = true
  session.emit?.({ type: 'turn.started' })
  let streamed = ''
  const emitDelta = (chunk: string) => {
    if (controller.signal.aborted) return
    streamed += chunk
    session.emit?.({ type: 'text.delta', text: chunk })
  }
  try {
    const run: ScriptedTurnHandler =
      handler ??
      (async ctx => {
        const reply = `echo: ${ctx.input.text}`
        for (const chunk of reply.match(/.{1,8}/g) ?? [reply]) ctx.emitDelta(chunk)
        return reply
      })
    const out = await run({
      nativeId: session.nativeId,
      chatId: session.chatId,
      workspace: session.workspace,
      input,
      hidden: session.hidden,
      signal: controller.signal,
      emitDelta,
      callMcp,
      ...(session.reviewTools ? { reviewTools: [...session.reviewTools] } : {})
    })
    const finalText = typeof out === 'string' ? out : out.text
    const status = controller.signal.aborted ? 'stopped' : typeof out === 'string' ? 'completed' : (out.status ?? 'completed')
    const usage = typeof out === 'string' ? DEFAULT_USAGE : (out.usage ?? DEFAULT_USAGE)
    const rowId = appendRow(session, { kind: 'assistant', text: finalText, ...(status === 'stopped' ? { stopped: true } : {}), usage })
    session.emit?.({ type: 'turn.finished', status, text: finalText, contextTokens: usage.contextTokens, usage, rowId })
    return { status, text: finalText }
  } catch (error) {
    const stopped = controller.signal.aborted
    const text = stopped ? streamed : error instanceof Error ? error.message : 'Scripted turn failed'
    const status = stopped ? 'stopped' : 'failed'
    const rowId = appendRow(session, { kind: 'assistant', text, ...(stopped ? { stopped: true } : {}) })
    session.emit?.({ type: 'turn.finished', status, text, rowId })
    return { status, text }
  } finally {
    session.running = false
    if (session.controller === controller) session.controller = null
  }
}

export function openScriptedChat(
  sessions: Map<string, ScriptedSession>,
  create: (nativeId: string, workspace: string, hidden: boolean) => ScriptedSession,
  callMcp: (nativeId: string, chatId: string, tool: string, args?: Record<string, unknown>, server?: string) => Promise<McpCallResult>,
  getHandler: () => ScriptedTurnHandler | undefined,
  engineBotId: string,
  chatId: string | null,
  options: ChatOptions,
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
  resumeOutcomes?: Map<string, ResumeOutcome[]>
): OpenChat {
  const tryResume = (): ScriptedSession | 'not_found' => {
    const scripted = chatId ? resumeOutcomes?.get(chatId)?.shift() : undefined
    if (scripted instanceof Error) throw scripted
    if (scripted === 'not_found') return 'not_found'
    return (chatId && sessions.get(chatId)) || 'not_found'
  }
  let session: ScriptedSession | undefined
  let resumeRefused: string | undefined
  if (chatId) {
    const first = tryResume()
    if (first === 'not_found') {
      const second = tryResume()
      if (second === 'not_found') {
        if (options.requireExisting) throw new LilBotError('chat_not_found', 'That conversation no longer exists.')
        resumeRefused = 'session_not_found'
      } else {
        session = second
      }
    } else {
      session = first
    }
  }
  if (!session) session = create(engineBotId, options.workspace, false)
  session.emit = onEvent
  const active = session
  return {
    imageSupport: 'supported',
    resumeRefused,
    snapshot: { chatId: active.chatId, botId: engineBotId, title: active.title, running: active.running, workspace: active.workspace, items: [...active.items] },
    send: async (text, sendOptions) => {
      if (sendOptions?.inputId && active.seenInputIds.has(sendOptions.inputId)) return
      if (sendOptions?.inputId) active.seenInputIds.add(sendOptions.inputId)
      const turn = runScriptedTurn(active, { text, ...sendOptions }, (t, a, s) => callMcp(engineBotId, active.chatId, t, a, s), getHandler())
      await awaitWithDisconnect(turn, signal)
    },
    stop: async () => active.controller?.abort(),
    close: () => {
      if (active.emit === onEvent) active.emit = undefined
    }
  }
}

export function conversationSource(sessions: Map<string, ScriptedSession>, nativeId: string): ConversationSource {
  return {
    list: async () =>
      [...sessions.values()]
        .filter(s => s.nativeId === nativeId && !s.hidden)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(s => ({ id: s.chatId, at: s.createdAt })),
    read: async (id, cursor, latest) => {
      const session = sessions.get(id)
      if (!session || session.nativeId !== nativeId) return { rows: [], cursor: null, reset: false, empty: true }
      const start = latest ? 0 : Number(cursor ?? 0)
      const slice = session.rows.slice(start, start + 100)
      const next = start + slice.length
      return { rows: slice, cursor: next > start ? String(next) : (cursor ?? null), reset: false, empty: next >= session.rows.length }
    },
    close: () => {}
  }
}
