/** Routine tools: a bot schedules work for itself with the functions the screens use (`routines.*`). One tool for the
 *  steps and one to read, so a bot pays two listing lines a turn instead of five. */
import { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { RoutineActionInput, RoutineCreate } from '../../shared/routine-schema'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

const RUNS_SHOWN = 5
const RESULT_SHOWN = 500

export function routineTools({ routines }: SystemDeps): McpTool[] {
  return [
    actionTool(
      'lilbot_routine',
      "Schedule work for yourself, or pause, resume or delete your own routines, instead of the engine's cron. create: requestId, description, schedule (interval of at least 300 seconds, daily at HH:MM, or weekly on a day 0-6 at HH:MM, default zone Australia/Adelaide) and createdBy (oscar only when he asked for the schedule, otherwise bot; at most five of your own, paused included). pause, resume and delete: id. Each run is its own session in your folder with full access and its result appears only in Routines; it is not a new request from Oscar. Reuse requestId when retrying.",
      RoutineActionInput,
      async (caller, { action, id, ...fields }) => {
        if (action === 'create') return routines.create(caller, RoutineCreate.parse(fields))
        if (!id) throw new LilBotError('routine_id_missing', `Give the id of the routine to ${action}.`)
        return { id, ...(action === 'delete' ? await routines.delete(caller, id) : await routines.pause(caller, id, action === 'pause')) }
      }
    ),
    readTool('lilbot_routines_list', 'Your routines: schedule, next run, and the latest runs with their results cut short.', z.object({}), async caller =>
      (await routines.list(caller)).map(routine => ({
        ...routine,
        runs: routine.runs.slice(0, RUNS_SHOWN).map(run => ({ ...run, result: run.result.slice(0, RESULT_SHOWN) }))
      }))
    )
  ]
}
