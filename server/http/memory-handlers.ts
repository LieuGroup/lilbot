/** Oscar's browser methods for memory: the Settings > Memory page and the delete dialog's private-fact count. */
import type { Method } from '../../shared/protocol'
import type { BotService } from '../bots/bot-service'
import type { Handlers } from './browser-session'

type MemoryMethod = Extract<Method, `memory.${string}`>

const ok = async (run: () => void) => {
  run()
  return { ok: true as const }
}

export function memoryHandlers(bots: () => BotService): Pick<Handlers, MemoryMethod> {
  return {
    'memory.list': ({ botId }) => bots().listMemory(botId),
    'memory.listAll': async input => bots().browseMemory(input),
    'memory.write': input => bots().writeMemory(input),
    'memory.forget': ({ factId }) => ok(() => bots().forgetMemory(factId)),
    'memory.restore': ({ factId }) => ok(() => bots().restoreMemory(factId)),
    'memory.pause': ({ factId, paused }) => ok(() => bots().pauseMemory(factId, paused)),
    'memory.connect': ({ botId }) => bots().connectMemory(botId)
  }
}
