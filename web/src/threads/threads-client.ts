/** Read-only data client for the future shared-thread screen. */
import { lilbot } from '@/app/lilbot-socket'

export const threadsClient = {
  list: (botId: string) => lilbot.call('threads.list', { botId }),
  open: (botId: string, threadId: string) => lilbot.call('threads.open', { botId, threadId }),
  onChanged: (listener: () => void) => lilbot.onThreadsChanged(listener)
}
