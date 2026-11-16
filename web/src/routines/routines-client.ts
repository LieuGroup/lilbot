/** Data API for the future Routines panel. The layout is tracked separately with needs-ui. */
import { lilbot } from '@/app/lilbot-socket'

export const routinesClient = {
  list: (botId: string) => lilbot.call('routines.list', { botId }),
  pause: (botId: string, id: string) => lilbot.call('routines.pause', { botId, id }),
  resume: (botId: string, id: string) => lilbot.call('routines.resume', { botId, id }),
  delete: (botId: string, id: string) => lilbot.call('routines.delete', { botId, id }),
  openRun: (botId: string, runId: string) => lilbot.call('routines.openRun', { botId, runId }),
  onChanged: (listener: () => void) => lilbot.onRoutinesChanged(listener)
}
