/** Persistent, read-only profile sockets. No chat is resumed by the observer. */

import type { ActivityEvent } from '../../../shared/activity-schema'
import type { ChatEvent } from '../../../shared/chat-schema'
import { backgroundFailure } from '../../background'
import { type ActivityReplayState, type ActivityUpdate, applyActivityReplay, replayNeedsReset, replayPosition } from '../activity-replay'
import type { RuntimeBinding } from '../bot-engine'
import { chatEventFrom } from './hermes-chat-mapping'
import { HermesSocket } from './hermes-socket'

type Cursor = (botId: string, chatId: string) => string | undefined
type Observer = { socket?: HermesSocket; retryAt: number; failures: number; sessions: Map<string, ActivityReplayState> }

export function watchHermesActivity(
  bots: () => Promise<RuntimeBinding[]>,
  emit: (event: ActivityEvent) => void,
  cursor: Cursor,
  conversationEvent?: (botId: string, chatId: string, event: ChatEvent, key: string) => void
): () => void {
  const startedAt = Date.now() / 1000
  const observers = new Map<string, Observer>()
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  const read = async ({ id: botId, engineBotId }: RuntimeBinding, observer: Observer) => {
    if (Date.now() < observer.retryAt) return
    try {
      if (!observer.socket?.isOpen) {
        const socket = await HermesSocket.connect(engineBotId === 'default' ? '' : engineBotId)
        if (stopped) {
          socket.close()
          return
        }
        observer.socket = socket
      }
      const socket = observer.socket
      const result = await socket.request('session.list', { scope: 'live', limit: 200, include_hidden: false })
      const live = new Set<string>()
      for (const row of result.sessions) {
        if (stopped) return
        const chatId = row.session_id
        live.add(chatId)
        const previous = observer.sessions.get(chatId)
        const saved = previous ? `${previous.epoch}:${previous.sequence}` : cursor(botId, chatId)
        let replay = await socket.request('session.events.since', { session_id: chatId, ...replayPosition(previous) })
        const reset = replayNeedsReset(previous, replay.replay_epoch, replay.truncated)
        // One full read re-baselines a gap/epoch change; do not loop if the buffer is itself truncated.
        if (reset) replay = await socket.request('session.events.since', { session_id: chatId, last_sequence: 0, replay_epoch: replay.replay_epoch })
        if (conversationEvent)
          for (const event of replay.events) {
            const mapped = chatEventFrom(event)
            if (mapped) conversationEvent(botId, chatId, mapped, `${replay.replay_epoch}:${event.seq}`)
          }
        const updates: ActivityUpdate[] = replay.events.map((event: any) => ({
          sequence: event.seq,
          ...(event.type === 'message.start' ? { status: 'working', clearTool: true } : {}),
          ...(event.type === 'tool.start' ? { status: 'working', tool: event.payload.name } : {}),
          ...(event.type === 'tool.complete' ? { clearTool: true } : {}),
          ...(event.type === 'message.complete' ? { status: event.payload.status === 'error' ? 'failed' : 'finished', clearTool: true } : {}),
          spoke: ['message.delta', 'message.interim', 'message.complete'].includes(event.type) && !!event.payload.text
        }))
        const { state, spoke } = applyActivityReplay(
          reset ? undefined : previous,
          {
            epoch: replay.replay_epoch,
            sequence: replay.last_sequence,
            updates,
            running: row.running,
            waiting: !!replay.open_requests?.length
          },
          saved
        )
        const fresh = !saved
        const baseline = fresh && !row.running && row.started_at < startedAt
        if (baseline) state.status = 'idle'
        const key = `${state.epoch}:${state.sequence}`
        if (key !== saved || (row.running && !previous)) emit({ botId, chatId, key, status: state.status, tool: state.tool, spoke: !baseline && spoke })
        observer.sessions.set(chatId, state)
      }
      for (const id of observer.sessions.keys()) if (!live.has(id)) observer.sessions.delete(id)
      observer.failures = 0
      observer.retryAt = 0
    } catch {
      backgroundFailure('activity observation')
      observer.socket?.close()
      observer.socket = undefined
      observer.retryAt = Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(observer.failures++, 6))
    }
  }
  const sweep = async () => {
    const start = Date.now()
    try {
      const roster = await bots()
      if (stopped) return
      const live = new Set(roster.map(bot => bot.id))
      for (const [id, observer] of observers)
        if (!live.has(id)) {
          observer.socket?.close()
          observers.delete(id)
        }
      await Promise.all(
        roster.map(bot => {
          let observer = observers.get(bot.id)
          if (!observer) {
            observer = { retryAt: 0, failures: 0, sessions: new Map() }
            observers.set(bot.id, observer)
          }
          return read(bot, observer)
        })
      )
    } catch {
      backgroundFailure('activity roster')
    } finally {
      if (!stopped) timer = setTimeout(sweep, Math.max(0, 1000 - (Date.now() - start)))
    }
  }
  void sweep()
  return () => {
    stopped = true
    clearTimeout(timer)
    for (const observer of observers.values()) observer.socket?.close()
    observers.clear()
  }
}
