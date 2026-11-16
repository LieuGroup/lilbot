import { z } from 'zod'

const timeZone = z
  .string()
  .default('Australia/Adelaide')
  .refine(value => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, 'Use an IANA time zone, such as Australia/Adelaide.')
export const RoutineSchedule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), seconds: z.number().int().min(1).max(31_536_000) }),
  z.object({ kind: z.literal('daily'), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone }),
  z.object({ kind: z.literal('weekly'), day: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone })
])
export type RoutineSchedule = z.infer<typeof RoutineSchedule>
export const RoutineCreate = z.object({
  requestId: z.string().min(1).max(200),
  description: z.string().trim().min(1).max(20_000),
  schedule: RoutineSchedule,
  createdBy: z.enum(['oscar', 'bot'])
})
export type RoutineCreate = z.infer<typeof RoutineCreate>
export interface RoutineRun {
  id: string
  routineId: string
  botId: string
  dueAt: number
  startedAt: number | null
  finishedAt: number | null
  chatId: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  result: string
}
export interface Routine {
  id: string
  botId: string
  description: string
  schedule: RoutineSchedule
  scheduleText: string
  createdBy: 'oscar' | 'bot'
  paused: boolean
  lastRunAt: number | null
  nextRunAt: number
  runs: RoutineRun[]
}
