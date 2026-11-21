/** Keeps a per-bot read fresh while something on screen shows it: the first watcher of a bot reads it, and every watched
 *  bot is read again on the given pushes and on reconnect. Returns the effect: `useEffect(() => watch(botId), [botId])`. */
import { lilbot } from './lilbot-socket'

export function watchedReads(load: (botId: string) => Promise<void>, pushes: ((listener: () => void) => unknown)[]) {
  const watching = new Map<string, number>()
  let started = false
  const reload = () => {
    for (const botId of watching.keys()) void load(botId)
  }
  return (botId: string) => {
    if (!started) {
      started = true
      for (const push of pushes) push(reload)
      lilbot.onConnection(connected => {
        if (connected) reload()
      })
    }
    watching.set(botId, (watching.get(botId) ?? 0) + 1)
    if (watching.get(botId) === 1) void load(botId)
    return () => {
      const left = (watching.get(botId) ?? 1) - 1
      if (left > 0) watching.set(botId, left)
      else watching.delete(botId)
    }
  }
}
