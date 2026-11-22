/** Shared types for the leader-side remote worker runner and its inbound frame dispatcher. */
import type { Database } from 'bun:sqlite'
import type { ChatItem } from '../../shared/chat-schema'
import type { WorkerAgentInfo, WorkerDriverId, WorkerStartFrame } from '../../shared/worker-frame-schema'
import type { RemoteWorkerResult } from './remote-worker-store'

export interface RemoteWorkerRunInput {
  runId: string
  computerId: string
  botId: string
  threadId: string
  chatId: string
  cwd: string
  model: string
  reasoningEffort?: string
  driver?: WorkerDriverId
  sessionId?: string
  systemPrompt: string
  prompt: string
  onChat?: (chatId: string) => void
}

export interface RemoteWorkerMcpContext {
  botId: string
  threadId: string
  chatId: string
  runId: string
  computerId: string
}

export interface RemoteToolEvent {
  botId: string
  chatId: string
  tool: string
  activity: string
  callId?: string
}

export interface RemoteWorkerRunnerOptions {
  db: Database
  botExists: (botId: string) => boolean
  isRevoked?: (computerId: string) => boolean
  handleMcp: (ctx: RemoteWorkerMcpContext, body: string) => Promise<{ status: number; body: string }>
  onCapabilitiesChanged?: (computerId: string, agents: WorkerAgentInfo[]) => void
  offlineGraceMs?: number
  stopGraceMs?: number
  steerTimeoutMs?: number
}

export interface ActiveRun {
  runId: string
  computerId: string
  botId: string
  threadId: string
  chatId: string
  sessionId?: string
  resumedFrom?: string
  sawEvent: boolean
  pendingStart?: WorkerStartFrame
  sentStart: boolean
  stopping: boolean
  emittedWorking: boolean
  seenToolIds: Set<string>
  tools: Map<string, Extract<ChatItem, { kind: 'tool' }>>
  confirmedSteers: string[]
  waiters: ((result: RemoteWorkerResult) => void)[]
  offlineTimer?: ReturnType<typeof setTimeout>
  stopTimer?: ReturnType<typeof setTimeout>
}

export interface PendingSteer {
  runId: string
  computerId: string
  text: string
  timer: ReturnType<typeof setTimeout>
  resolve: (status: 'steered' | 'not_running') => void
}
