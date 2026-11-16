/** Backend data for the future skills panel; Setup already consumes abilities. */
import { lilbot } from '@/app/lilbot-socket'
export const skillsClient = {
  list: (botId: string) => lilbot.call('skills.list', { botId }),
  read: (botId: string, name: string) => lilbot.call('skills.read', { botId, name }),
  setEnabled: (botId: string, name: string, enabled: boolean) => lilbot.call('skills.setEnabled', { botId, name, enabled }),
  onChanged: (listener: () => void) => lilbot.onSkillsChanged(listener)
}
