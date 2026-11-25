/** Oscar's browser methods for memory: the Settings > Memory page, the delete dialog's private-fact count,
 *  and the pre-compress refusal choice card. */
import type { Method } from '../../shared/protocol'
import type { Handlers } from './browser-session'
import { type CheckpointChoiceDeps, handleCheckpointChoice } from './checkpoint-choice-handler'

type MemoryMethod = Extract<Method, `memory.${string}`>

const ok = async (run: () => void) => {
  run()
  return { ok: true as const }
}

export function memoryHandlers(getDeps: () => CheckpointChoiceDeps): Pick<Handlers, MemoryMethod> {
  return {
    'memory.list': ({ botId }) => getDeps().bots.listMemory(botId),
    'memory.listAll': async input => getDeps().bots.browseMemory(input),
    'memory.write': input => getDeps().bots.writeMemory(input),
    'memory.forget': ({ factId }) => ok(() => getDeps().bots.forgetMemory(factId)),
    'memory.restore': ({ factId }) => ok(() => getDeps().bots.restoreMemory(factId)),
    'memory.pause': ({ factId, paused }) => ok(() => getDeps().bots.pauseMemory(factId, paused)),
    'memory.connect': ({ botId }) => getDeps().bots.connectMemory(botId),
    'memory.checkpointPending': async ({ botId, chatId }) => getDeps().choices?.pending(botId, chatId) ?? null,
    'memory.checkpointChoose': (input, afterResponse) => handleCheckpointChoice(getDeps(), input, afterResponse)
  }
}
