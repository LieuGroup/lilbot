import type { ChatEvent } from '../../../shared/chat-schema'
import { LilBotError } from '../../../shared/protocol'
import type { ChatOptions, OpenChat } from '../bot-engine'
import { prepareAttachments } from './hermes-attachments'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { chatEventFrom, itemsFromRows, sessionLostEvents } from './hermes-chat-mapping'
import { ensureFullAccess } from './hermes-permissions'
import { wireEffort } from './hermes-session-settings'
import { type HermesEvent, HermesSocket } from './hermes-socket'
import type { SpareSockets } from './hermes-spare-sockets'
import { reportToolCall } from './hermes-tool-calls'

const CLIENT = { name: 'lilbot', version: '0.2.0' }
const notFound = (error: unknown) => error instanceof LilBotError && error.code === 'hermes_not_found'
const ignore = () => {}

export async function openChat(
  spares: SpareSockets,
  botId: string,
  chatId: string | null,
  options: ChatOptions,
  onEvent: (event: ChatEvent) => void,
  connect = HermesSocket.connect
): Promise<OpenChat> {
  let sessionId = ''
  let generation: number | null = null
  let closed = false
  const reportEffort = (effort: string | null | undefined) => {
    if (effort !== undefined) options.onEffort?.(effort)
  }

  // Hermes binds a session to the profile its connection was attached with (checked live:
  // another profile's session is refused with profile_mismatch), so each chat has its own.
  // A spare made after the bot's last open skips the attach step.
  const profile = botId === DEFAULT_PROFILE ? '' : botId
  const onSocketEvent = (event: HermesEvent) => {
    if (closed || (event.sessionId && sessionId && event.sessionId !== sessionId)) return
    if (sessionLostEvents.has(event.type)) {
      closed = true
      socket.close()
      onEvent({ type: 'closed', message: 'The bot moved this conversation. Reopening it.' })
      return
    }
    if (event.executionGeneration !== undefined) generation = event.executionGeneration
    // A change picked during a turn takes effect when the turn ends and is announced here.
    if (event.type === 'session.info') reportEffort(wireEffort(event.payload))
    reportToolCall(profile, event.sessionId ?? sessionId, event.type, event.payload)
    const mapped = chatEventFrom(event)
    if (mapped) onEvent(mapped)
  }
  const onSocketClose = () => {
    if (closed) return
    closed = true
    onEvent({ type: 'closed', message: 'The connection to the bot was lost.' })
  }
  const attach = () => connect(profile, onSocketEvent, onSocketClose)
  const spare = await spares.take(profile)
  let socket = spare ? spare.rebind(onSocketEvent, onSocketClose) : await attach()

  try {
    await ensureFullAccess(socket)
    let session: any = null
    let refused: string | undefined
    if (chatId) {
      const resume = () => socket.request('session.resume', { session_id: chatId, source: 'gui', display_projection: true, omit_messages: options.omitMessages ?? false })
      // Only a chat that no longer exists is replaced by a fresh one. Any other refusal (Hermes
      // restarting, a contract change) is an error, so a long conversation is never swapped
      // for an empty one by accident. "Not found" is asked again on a newly attached connection
      // first, so a refusal that belongs to one connection (a spare among them) loses nothing.
      session = await resume().catch(async error => {
        if (options.requireExisting || !notFound(error)) throw error
        socket.rebind(ignore, ignore).close()
        socket = await attach()
        return resume().catch(error => {
          if (!notFound(error)) throw error
          refused = error.code
          return null
        })
      })
    }
    // A new chat starts in the bot's own folder. A resumed chat keeps the folder it was made with.
    session ??= await socket.request('session.create', {
      source: 'gui',
      request_id: crypto.randomUUID(),
      client: CLIENT,
      cwd: options.workspace,
      cwd_explicit: true,
      ...(options.reasoningEffort ? { reasoning: options.reasoningEffort } : {})
    })
    sessionId = session.session_id
    reportEffort(wireEffort(session.info))
    if (typeof session.execution_generation === 'number') generation = session.execution_generation
    spares.refill(profile)

    return {
      // ModelCapabilities in model.options has no vision field. Do not infer from names.
      imageSupport: 'unknown',
      ...(refused ? { resumeRefused: refused } : {}),
      snapshot: {
        chatId: session.stored_session_id ?? session.session_id,
        botId,
        title: typeof session.info?.title === 'string' ? session.info.title : '',
        running: session.running === true,
        workspace: typeof session.info?.cwd === 'string' ? session.info.cwd : '',
        items: itemsFromRows(session.display_messages)
      },
      send: async (text, options) => {
        // The origin line is model-only (`api_text`), so the stored transcript keeps exactly what Oscar wrote.
        const modelText = options?.origin ? `${options.apiText ?? text}\n\n${options.origin.line}` : options?.apiText
        await socket.request('prompt.submit', {
          session_id: sessionId,
          text,
          input_id: options?.inputId ?? crypto.randomUUID(),
          ...(options?.hidden ? { display_kind: 'hidden' } : {}),
          ...(options?.attachments?.length ? await prepareAttachments(socket, sessionId, modelText ?? text, options.attachments) : modelText ? { api_text: modelText } : {})
        })
      },
      stop: async () => {
        if (generation === null) throw new LilBotError('not_running', 'The bot is not running.')
        await socket.request('session.interrupt', { session_id: sessionId, execution_generation: generation })
      },
      close: () => {
        closed = true
        socket.close()
      }
    }
  } catch (error) {
    closed = true
    socket.close()
    throw error
  }
}
