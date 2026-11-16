import { z } from 'zod'

export const ReportInput = z.object({
  requestId: z.string().min(1).max(100),
  kind: z.enum(['result', 'question', 'blocked']),
  text: z.string().trim().min(1).max(8000),
  chatId: z.string().min(1).max(200)
})
export type ReportInput = z.infer<typeof ReportInput>
export const ReportAnswer = z.object({ id: z.string().min(1), text: z.string().trim().min(1).max(8000) })
export type ReportAnswer = z.infer<typeof ReportAnswer>
export interface Report {
  id: string
  botId: string
  botName: string
  kind: ReportInput['kind']
  text: string
  chatId: string
  runId: string | null
  link: string
  createdAt: number
  status: 'pending' | 'answered' | 'told_oscar'
  primaryId: string | null
  response: string | null
  handledAt: number | null
  batchId: string | null
}
export interface ReportDelivery {
  id: string
  botId: string
  kind: 'batch' | 'answer'
  reportId: string | null
  chatId: string | null
  text: string
  finished: boolean
}
