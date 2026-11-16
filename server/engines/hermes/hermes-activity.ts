/** One rotating, read-only observer socket. Attach tickets are profile-bound; no chat is resumed. */
import type { ActivityEvent } from '../../../shared/activity-schema'
import { HermesSocket } from './hermes-socket'

type Cursor = (botId: string, chatId: string) => string | undefined

export function watchHermesActivity(bots: () => Promise<{ id: string }[]>, emit: (event: ActivityEvent) => void, cursor: Cursor): () => void {
  const startedAt = Date.now() / 1000
  let stopped = false
  let socket: HermesSocket | undefined
  let profile = ''
  let timer: ReturnType<typeof setTimeout>
  const seen = new Map<string, string>()
  const read = async (botId: string) => {
    if (!socket?.isOpen || profile !== botId) {
      socket?.close()
      socket = await HermesSocket.connect(
        botId === 'default' ? '' : botId,
        () => {},
        () => {}
      )
      profile = botId
    }
    const result = await socket.request('session.list', { scope: 'live', limit: 200, include_hidden: false })
    for (const row of result.sessions) {
      if (stopped) return
      const chatId = row.session_id
      const id = `${botId}/${chatId}`
      const saved = seen.get(id) ?? cursor(botId, chatId)
      const [epoch, sequence] = saved?.split(':') ?? []
      const replay = await socket.request('session.events.since', {
        session_id: chatId,
        last_sequence: 0,
        ...(epoch ? { replay_epoch: epoch } : {})
      })
      const fresh = !saved
      let status: ActivityEvent['status'] = row.running ? 'working' : 'idle'
      let tool: string | undefined
      let spoke = false
      for (const event of replay.events) {
        if (event.type === 'message.start') {
          status = 'working'
          tool = undefined
        }
        if (event.type === 'tool.start') {
          status = 'working'
          tool = event.payload.name
        }
        if (event.type === 'tool.complete') tool = undefined
        if ((event.type === 'message.delta' || event.type === 'message.interim') && event.seq > (Number(sequence) || 0)) spoke ||= !!event.payload.text
        if (event.type === 'message.complete') {
          status = event.payload.status === 'error' ? 'failed' : 'finished'
          tool = undefined
          if (event.seq > (Number(sequence) || 0)) spoke ||= !!event.payload.text
        }
      }
      if (replay.open_requests?.length) status = 'waiting'
      const key = `${replay.replay_epoch}:${replay.last_sequence}`
      // Old idle history is a baseline, not a new reply. A running turn is always visible.
      if (fresh && !row.running && row.started_at < startedAt) {
        status = 'idle'
        spoke = false
      }
      if (key !== saved || (row.running && fresh)) emit({ botId, chatId, key, status, tool, spoke })
      seen.set(id, key)
    }
  }
  const sweep = async () => {
    try {
      for (const bot of await bots()) {
        if (stopped) break
        try {
          await read(bot.id)
        } catch (error) {
          console.error('[activity] could not observe bot:', bot.id, error instanceof Error ? error.message : error)
          socket?.close()
          socket = undefined
        }
      }
    } catch (error) {
      console.error('[activity] could not list bots:', error instanceof Error ? error.message : error)
    } finally {
      if (stopped) socket?.close()
      else timer = setTimeout(sweep, 1000)
    }
  }
  void sweep()
  return () => {
    stopped = true
    clearTimeout(timer)
    socket?.close()
  }
}
