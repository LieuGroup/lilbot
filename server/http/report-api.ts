import { z } from 'zod'
import { LilBotError } from '../../shared/protocol'
import { ReportAnswer, ReportInput } from '../../shared/report-schema'
import type { ReportService } from '../reports/report-service'

export async function reportApi(service: ReportService, botId: string, action: string, body: unknown) {
  if (action === 'send') {
    const input = ReportInput.extend({ reportTurn: z.boolean().default(false) }).parse(body)
    return service.send(botId, input, input.reportTurn)
  }
  if (action === 'answer') return service.answer(botId, ReportAnswer.parse(body))
  throw new LilBotError('not_found', 'Unknown report operation.')
}
