import { z } from 'zod'
import { RoutineCreate } from '../../shared/routine-schema'
import type { RoutineService } from '../routines/routine-service'

/** Caller comes from the authenticated capability, never from the request body's botId. */
export async function routineApi(service: RoutineService, callerId: string, action: string, raw: unknown) {
  if (action === 'create') return service.create(callerId, RoutineCreate.parse(raw))
  if (action === 'list') return service.list(callerId)
  const { id } = z.object({ id: z.string().min(1) }).parse(raw)
  if (action === 'pause' || action === 'resume') return service.pause(callerId, id, action === 'pause')
  if (action === 'delete') return service.delete(callerId, id)
  throw new Error('Unknown routine action.')
}
