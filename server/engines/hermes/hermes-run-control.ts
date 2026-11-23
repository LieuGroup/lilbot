/** Stop or steer a running hidden session from a fresh connection. `session.resume` gives the live session and its
 *  execution generation; checked live on the dev gateway, both calls work from a second socket while another one
 *  waits on the run's receipt (interrupt ends a turn within about a second, even inside a long command). */
import { LilBotError } from '../../../shared/lilbot-error'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { HermesSocket } from './hermes-socket'

type Act<T> = (socket: HermesSocket, sessionId: string, generation: number) => Promise<T>
const notFound = (error: unknown) => error instanceof LilBotError && error.code === 'hermes_not_found'

async function resumeForControl(profile: string, chatId: string, socket: HermesSocket, connect: typeof HermesSocket.connect) {
  const resume = (s: HermesSocket) => s.request('session.resume', { session_id: chatId, source: 'tool', display_projection: true, omit_messages: true })
  try {
    return { socket, session: await resume(socket) }
  } catch (error) {
    if (!notFound(error)) throw error
    socket.close()
    const fresh = await connect(profile)
    try {
      return { socket: fresh, session: await resume(fresh) }
    } catch (retryError) {
      fresh.close()
      if (notFound(retryError)) throw new LilBotError('session_not_found', 'That conversation no longer exists.')
      throw retryError
    }
  }
}

async function withRun<T>(botId: string, chatId: string, idle: T, act: Act<T>, connect = HermesSocket.connect): Promise<T> {
  const profile = botId === DEFAULT_PROFILE ? '' : botId
  let socket = await connect(profile)
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const resumed = await resumeForControl(profile, chatId, socket, connect)
      socket = resumed.socket
      const session = resumed.session
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

/** False when nothing was running; throws `session_not_found` after two fresh-connection confirmations. */
export const stopRun = (botId: string, chatId: string, connect = HermesSocket.connect) =>
  withRun(
    botId,
    chatId,
    false,
    async (socket, id, generation) => {
      await socket.request('session.interrupt', { session_id: id, execution_generation: generation })
      return true
    },
    connect
  )

/** Hermes delivers steered text after the current tool batch, as its own user row, without stopping the turn. */
export const steerRun = (botId: string, chatId: string, text: string, connect = HermesSocket.connect) =>
  withRun(
    botId,
    chatId,
    'not_running' as const,
    async (socket, id, generation) => {
      const result = await socket.request('session.steer', { session_id: id, execution_generation: generation, text })
      return result.status === 'queued' ? ('steered' as const) : ('not_running' as const)
    },
    connect
  )
