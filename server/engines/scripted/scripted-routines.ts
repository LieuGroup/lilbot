/** Durable routine/delivery admission tracking and client-disconnect racing for ScriptedEngine. */
import type { ModelProvider } from '../../../shared/bot-schema'
import type { ChatItem } from '../../../shared/chat-schema'
import { LilBotError } from '../../../shared/lilbot-error'
import type { ChatOptions, MemoryConnection, RoutineOptions, RuntimeIdentity, SkillSettings } from '../bot-engine'
import type { McpConnection } from '../mcp-connection'
import { runScriptedTurn, type ScriptedSession, type ScriptedTurnContext, type ScriptedTurnHandler } from './scripted-chat'

export const DEFAULT_SCRIPTED_MODELS: ModelProvider[] = [
  {
    provider: 'scripted',
    name: 'Scripted',
    models: ['echo', 'think'],
    capabilities: [
      { id: 'echo', reasoning: false, canDisableReasoning: true },
      { id: 'think', reasoning: true, canDisableReasoning: true }
    ]
  }
]

export interface ScriptedRuntime {
  nativeId: string
  identity: RuntimeIdentity
  connections: McpConnection[]
  skills?: SkillSettings
  computers?: { url: string; tokenFile: string; botId: string }
  memoryConnection?: MemoryConnection
  memoryConnected: boolean
}

export type ScriptedRoutineResult = {
  status: 'completed' | 'failed' | 'stopped'
  text: string
  items: ChatItem[]
  unknownReceipt?: true
}

export function awaitWithDisconnect<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new LilBotError('engine_unavailable', 'Client disconnected.'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new LilBotError('engine_unavailable', 'Client disconnected.'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

export class ScriptedRoutineLedger {
  private settled = new Map<string, { chatId: string; result: ScriptedRoutineResult }>()
  private inFlight = new Map<string, { chatId: string; promise: Promise<ScriptedRoutineResult> }>()
  private unknown = new Set<string>()

  loseReceipt(runId: string) {
    this.unknown.add(runId)
    this.settled.delete(runId)
    this.inFlight.delete(runId)
  }

  async run(
    options: RoutineOptions & ChatOptions,
    prompt: string,
    signal: AbortSignal,
    getSession: () => ScriptedSession,
    callMcp: (chatId: string) => ScriptedTurnContext['callMcp'],
    handler: ScriptedTurnHandler | undefined
  ): Promise<ScriptedRoutineResult> {
    if (this.unknown.has(options.runId)) {
      return { status: 'failed', text: 'Routine ended: unknown. Execution was not retried.', items: [], unknownReceipt: true }
    }
    const cached = this.settled.get(options.runId)
    if (cached) {
      options.onChat(cached.chatId)
      return cached.result
    }
    const active = this.inFlight.get(options.runId)
    if (active) {
      options.onChat(active.chatId)
      return awaitWithDisconnect(active.promise, signal)
    }
    const session = getSession()
    session.routineOptions = options
    options.onChat(session.chatId)
    const base = options.baseline?.(session.items.length) ?? 0
    const engineWork = runScriptedTurn(session, { text: prompt, hidden: options.hiddenInput, origin: options.origin, inputId: options.runId }, callMcp(session.chatId), handler)
      .then(outcome => {
        const result: ScriptedRoutineResult = { ...outcome, items: session.items.slice(base) }
        if (!this.unknown.has(options.runId)) this.settled.set(options.runId, { chatId: session.chatId, result })
        return result
      })
      .finally(() => {
        if (this.inFlight.get(options.runId)?.promise === engineWork) this.inFlight.delete(options.runId)
      })
    this.inFlight.set(options.runId, { chatId: session.chatId, promise: engineWork })
    return awaitWithDisconnect(engineWork, signal)
  }
}
