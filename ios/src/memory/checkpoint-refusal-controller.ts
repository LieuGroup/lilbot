/** Pure state controller for the pre-compress memory-save refusal card: loads `memory.checkpointPending`,
 *  subscribes to `memory.changed` for cross-device sync, submits `memory.checkpointChoose`,
 *  and keeps the settled notice visible until the user switches chats or sends another message. */
import { messageOf } from '../../../shared/client/socket'
import type { CheckpointChoice, MemoryCheckpointRefusal } from '../../../shared/memory-schema'

export interface SettledCheckpointChoice {
  needsResend?: boolean
}

export interface CheckpointRefusalSocket {
  call(method: 'memory.checkpointPending', params: { botId: string; chatId?: string }): Promise<MemoryCheckpointRefusal | null>
  call(
    method: 'memory.checkpointChoose',
    params: { botId: string; chatId: string; pieceKey: string; choice: CheckpointChoice; deviceId?: string }
  ): Promise<{ ok: true; choice: CheckpointChoice; resumed: boolean; needsResend?: boolean }>
  onMemoryChanged(listener: () => void): () => void
}

export interface CheckpointRefusalState {
  pending: MemoryCheckpointRefusal | null
  settled: SettledCheckpointChoice | null
  busy: CheckpointChoice | null
  error: string
}

export const INITIAL_CHECKPOINT_STATE: CheckpointRefusalState = { pending: null, settled: null, busy: null, error: '' }

export function createCheckpointRefusalController(deps: {
  getSocket: () => CheckpointRefusalSocket | null
  onState: (state: CheckpointRefusalState) => void
  onNewChat: () => void
}) {
  let state: CheckpointRefusalState = { ...INITIAL_CHECKPOINT_STATE }
  let activeBotId = ''
  let activeChatId = ''
  let connected = false
  let loadSeq = 0
  let stopPush: (() => void) | null = null

  const emit = (next: CheckpointRefusalState) => {
    state = next
    deps.onState(next)
  }

  const load = () => {
    const botId = activeBotId
    const chatId = activeChatId
    const socket = connected && botId && chatId ? deps.getSocket() : null
    const seq = ++loadSeq
    if (!socket) {
      if (state.pending !== null || state.error !== '') emit({ ...state, pending: null, error: '' })
      return
    }
    void socket
      .call('memory.checkpointPending', { botId, chatId })
      .then(result => {
        if (seq !== loadSeq || botId !== activeBotId || chatId !== activeChatId) return
        emit({ ...state, pending: result, settled: result ? null : state.settled, error: result ? state.error : '' })
      })
      .catch(() => {})
  }

  const sync = (params: { botId: string; chatId: string; connected: boolean }) => {
    const contextChanged = params.botId !== activeBotId || params.chatId !== activeChatId
    activeBotId = params.botId
    activeChatId = params.chatId
    connected = params.connected
    stopPush?.()
    stopPush = null
    if (contextChanged) {
      loadSeq += 1
      emit({ ...INITIAL_CHECKPOINT_STATE })
    }
    if (!connected || !activeBotId || !activeChatId) {
      if (!contextChanged && state.pending !== null) emit({ ...state, pending: null })
      return
    }
    const socket = deps.getSocket()
    if (socket) stopPush = socket.onMemoryChanged(load)
    load()
  }

  const clearSettled = () => {
    if (state.settled !== null) emit({ ...state, settled: null })
  }

  const choose = async (choice: CheckpointChoice, deviceId?: string) => {
    const current = state.pending
    if (!current || state.busy !== null) return
    const socket = deps.getSocket()
    if (!socket) return
    const botId = activeBotId
    const chatId = activeChatId
    emit({ ...state, busy: choice, error: '' })
    try {
      const result = await socket.call('memory.checkpointChoose', {
        botId: current.botId,
        chatId: current.chatId,
        pieceKey: current.pieceKey,
        choice,
        ...(deviceId ? { deviceId } : {})
      })
      if (botId !== activeBotId || chatId !== activeChatId) return
      emit({ pending: null, settled: choice === 'skip_piece' ? { needsResend: result.needsResend } : null, busy: null, error: '' })
      if (choice === 'new_session') deps.onNewChat()
    } catch (failure) {
      if (botId !== activeBotId || chatId !== activeChatId) return
      emit({ ...state, busy: null, error: messageOf(failure) })
    }
  }

  const dispose = () => {
    loadSeq += 1
    stopPush?.()
    stopPush = null
  }

  return { sync, clearSettled, choose, dispose, getState: () => state }
}
