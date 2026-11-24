/** Per-bot bearer credential scoped strictly to pre-compress memory checkpoints (`/engine/history/save`). */
import { connectionCaller, connectionKey } from '../connections/connection-keys'
import type { MemoryConnection } from '../engines/bot-engine'

export const CHECKPOINT_KEY_PURPOSE = 'memory-checkpoint'

export const checkpointKeyFor = (engineToken: string, botId: string): string => connectionKey(engineToken, CHECKPOINT_KEY_PURPOSE, botId)

export const checkpointConnectionFor = (url: string, engineToken: string, botId: string): MemoryConnection => ({
  url,
  checkpointKey: checkpointKeyFor(engineToken, botId),
  botId
})

export const checkpointCallerFrom = (engineToken: string, botIds: string[], authorization: string): string | undefined =>
  connectionCaller(engineToken, CHECKPOINT_KEY_PURPOSE, botIds, authorization)
