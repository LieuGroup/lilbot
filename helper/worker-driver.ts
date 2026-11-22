/** Engine-neutral coding-agent driver contract for the helper.
 *  Adding a second coding agent (such as an ACP driver) is a second file implementing `WorkerDriver`. */
import type { ChatItem, TurnUsage } from '../shared/chat-schema'
import type { WorkerAgentInfo, WorkerDoneStatus, WorkerDriverId, WorkerToolEvent } from '../shared/worker-frame-schema'
import { claudeCodeDriver } from './worker-driver-claude'

interface WorkerMcpEndpoint {
  url: string
  token: string
}

export interface WorkerStartRequest {
  runId: string
  sessionId?: string
  cwd: string
  model: string
  reasoningEffort?: string
  systemPrompt?: string
  prompt: string
  mcp?: WorkerMcpEndpoint
}

export interface WorkerProgressEvent {
  sessionId?: string
  activity?: string
  tools?: WorkerToolEvent[]
  textPreview?: string
}

export interface WorkerOutcome {
  sessionId?: string
  status: WorkerDoneStatus
  text: string
  items: ChatItem[]
  usage?: TurnUsage
  error?: string
}

export interface WorkerHandle {
  steer(text: string): Promise<'steered' | 'not_running'>
  stop(): void
  done: Promise<WorkerOutcome>
}

export interface WorkerDriver {
  readonly id: WorkerDriverId
  detect(): Promise<WorkerAgentInfo | null>
  start(request: WorkerStartRequest, onEvent: (event: WorkerProgressEvent) => void): WorkerHandle
}

export function defaultWorkerDrivers(): WorkerDriver[] {
  return [claudeCodeDriver()]
}

export async function detectWorkerAgents(drivers: WorkerDriver[] = defaultWorkerDrivers()): Promise<WorkerAgentInfo[]> {
  const found: WorkerAgentInfo[] = []
  for (const driver of drivers) {
    const info = await driver.detect().catch(() => null)
    if (info) found.push(info)
  }
  return found
}
