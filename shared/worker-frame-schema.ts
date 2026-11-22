/** Worker protocol frames carried over the helper's existing signed WebSocket connection.
 *  Agent-neutral so any coding-agent driver (Claude Code first, ACP or others later) shares the same wire contract. */
import { z } from 'zod'
import { ChatItem, TurnUsage } from './chat-schema'

export const WorkerDriverId = z.enum(['claude-code'])
export type WorkerDriverId = z.infer<typeof WorkerDriverId>

export const WorkerAgentInfo = z.object({
  driver: WorkerDriverId,
  version: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[^\p{Cc}\p{Cf}]*$/u)
})
export type WorkerAgentInfo = z.infer<typeof WorkerAgentInfo>

export const WorkerToolEvent = z.object({
  toolId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  detail: z.string().max(500).default(''),
  running: z.boolean(),
  failed: z.boolean().optional()
})
export type WorkerToolEvent = z.infer<typeof WorkerToolEvent>

export const WorkerDoneStatus = z.enum(['completed', 'stopped', 'failed', 'interrupted'])
export type WorkerDoneStatus = z.infer<typeof WorkerDoneStatus>

const runId = z.string().min(1).max(100)
const sessionId = z.string().min(1).max(200)

/** Leader -> Helper worker frames. */
export const WorkerStartFrame = z.object({
  type: z.literal('worker.start'),
  runId,
  driver: WorkerDriverId.optional(),
  sessionId: sessionId.optional(),
  cwd: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\p{Cc}\p{Cf}]*$/u),
  model: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\p{Cc}\p{Cf}]*$/u),
  reasoningEffort: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[^\p{Cc}\p{Cf}]*$/u)
    .optional(),
  systemPrompt: z.string().max(200_000).optional(),
  prompt: z.string().min(1).max(500_000),
  mcpEnabled: z.boolean().default(true)
})
export type WorkerStartFrame = z.infer<typeof WorkerStartFrame>

export const WorkerSteerFrame = z.object({
  type: z.literal('worker.steer'),
  runId,
  steerId: z.string().min(1).max(100).optional(),
  text: z.string().min(1).max(100_000)
})
export type WorkerSteerFrame = z.infer<typeof WorkerSteerFrame>

export const WorkerStopFrame = z.object({ type: z.literal('worker.stop'), runId })
export type WorkerStopFrame = z.infer<typeof WorkerStopFrame>

export const WorkerMcpResponseFrame = z.object({
  type: z.literal('worker.mcp.response'),
  runId,
  callId: z.string().min(1).max(100),
  status: z.number().int().min(100).max(599).default(200),
  body: z.string().max(262_144)
})
export type WorkerMcpResponseFrame = z.infer<typeof WorkerMcpResponseFrame>

export const WorkerAckFrame = z.object({ type: z.literal('worker.ack'), runId })
export type WorkerAckFrame = z.infer<typeof WorkerAckFrame>

export const WorkerLeaderFrame = z.discriminatedUnion('type', [WorkerStartFrame, WorkerSteerFrame, WorkerStopFrame, WorkerMcpResponseFrame, WorkerAckFrame])
export type WorkerLeaderFrame = z.infer<typeof WorkerLeaderFrame>

/** Helper -> Leader worker frames. */
export const WorkerCapabilitiesFrame = z.object({
  type: z.literal('worker.capabilities'),
  agents: z.array(WorkerAgentInfo).max(4)
})
export type WorkerCapabilitiesFrame = z.infer<typeof WorkerCapabilitiesFrame>

export const WorkerEventFrame = z.object({
  type: z.literal('worker.event'),
  runId,
  sessionId: sessionId.optional(),
  activity: z.string().max(300).optional(),
  tools: z.array(WorkerToolEvent).max(32).optional(),
  textPreview: z.string().max(4000).optional()
})
export type WorkerEventFrame = z.infer<typeof WorkerEventFrame>

export const WorkerSteerResultFrame = z.object({
  type: z.literal('worker.steer.result'),
  runId,
  steerId: z.string().min(1).max(100).optional(),
  status: z.enum(['steered', 'not_running'])
})
export type WorkerSteerResultFrame = z.infer<typeof WorkerSteerResultFrame>

export const WorkerMcpRequestFrame = z.object({
  type: z.literal('worker.mcp.request'),
  runId,
  callId: z.string().min(1).max(100),
  body: z.string().max(262_144)
})
export type WorkerMcpRequestFrame = z.infer<typeof WorkerMcpRequestFrame>

export const WorkerDoneFrame = z.object({
  type: z.literal('worker.done'),
  runId,
  sessionId: sessionId.optional(),
  status: WorkerDoneStatus,
  text: z.string().max(500_000).default(''),
  items: z.array(ChatItem).max(2000).default([]),
  usage: TurnUsage.optional(),
  error: z.string().max(1000).optional()
})
export type WorkerDoneFrame = z.infer<typeof WorkerDoneFrame>

export const WorkerHelperFrame = z.discriminatedUnion('type', [WorkerCapabilitiesFrame, WorkerEventFrame, WorkerSteerResultFrame, WorkerMcpRequestFrame, WorkerDoneFrame])
export type WorkerHelperFrame = z.infer<typeof WorkerHelperFrame>
