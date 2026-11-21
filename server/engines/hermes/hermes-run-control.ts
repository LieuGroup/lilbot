/** Stop or steer a running hidden session from a fresh connection. `session.resume` gives the live session and its
 *  execution generation; checked live on the dev gateway, both calls work from a second socket while another one
 *  waits on the run's receipt (interrupt ends a turn within about a second, even inside a long command). */
import { LilBotError } from '../../../shared/lilbot-error'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { HermesSocket } from './hermes-socket'

type Act<T> = (socket: HermesSocket, sessionId: string, generation: number) => Promise<T>

async function withRun<T>(botId: string, chatId: string, idle: T, act: Act<T>): Promise<T> {
  const socket = await HermesSocket.connect(botId === DEFAULT_PROFILE ? '' : botId)
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await socket.request('session.resume', { session_id: chatId, source: 'tool', display_projection: true, omit_messages: true })
      if (session.running !== true || typeof session.execution_generation !== 'number') return idle
      try {
        return await act(socket, session.session_id, session.execution_generation)
      } catch (error) {
        // The run moved on to a new generation between the two calls: look once more.
        if (attempt || !(error instanceof LilBotError && error.code === 'hermes_stale_generation')) throw error
      }
    }
    return idle
  } finally {
    socket.close()
  }
}

/** False when nothing was running. */
export const stopRun = (botId: string, chatId: string) =>
  withRun(botId, chatId, false, async (socket, id, generation) => {
    await socket.request('session.interrupt', { session_id: id, execution_generation: generation })
    return true
  })

/** Hermes delivers steered text after the current tool batch, as its own user row, without stopping the turn. */
export const steerRun = (botId: string, chatId: string, text: string) =>
  withRun(botId, chatId, 'not_running' as const, async (socket, id, generation) => {
    const result = await socket.request('session.steer', { session_id: id, execution_generation: generation, text })
    return result.status === 'queued' ? ('steered' as const) : ('not_running' as const)
  })
