/** React hook binding the pure pre-compress memory-save refusal controller to the live LilBot socket. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CheckpointChoice } from '../../../shared/memory-schema'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import {
  type CheckpointRefusalSocket,
  type CheckpointRefusalState,
  createCheckpointRefusalController,
  INITIAL_CHECKPOINT_STATE
} from './checkpoint-refusal-controller'

export type { SettledCheckpointChoice } from './checkpoint-refusal-controller'

export function useCheckpointRefusal({
  botId,
  chatId,
  sendSeq,
  deviceId,
  onNewChat
}: {
  botId: string
  chatId: string
  sendSeq: number
  deviceId: string
  onNewChat: () => void
}) {
  const connected = useConnectionStore(state => state.connected)
  const [state, setState] = useState<CheckpointRefusalState>(INITIAL_CHECKPOINT_STATE)
  const onNewChatRef = useRef(onNewChat)
  onNewChatRef.current = onNewChat
  const controllerRef = useRef<ReturnType<typeof createCheckpointRefusalController> | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = createCheckpointRefusalController({
      getSocket: () => ensureSocket() as CheckpointRefusalSocket | null,
      onState: setState,
      onNewChat: () => onNewChatRef.current()
    })
  }

  useEffect(() => {
    controllerRef.current?.sync({ botId, chatId, connected })
  }, [botId, chatId, connected])

  useEffect(() => {
    if (sendSeq > 0) controllerRef.current?.clearSettled()
  }, [sendSeq])

  useEffect(() => () => controllerRef.current?.dispose(), [])

  const choose = useCallback((choice: CheckpointChoice) => void controllerRef.current?.choose(choice, deviceId), [deviceId])
  return { ...state, choose }
}
