import type { ComputerService } from '../computers/computer-service'

/** Called only after the private engine endpoint verified the bot-bound capability. */
export async function computerApi(computers: ComputerService, bot: string, action: string, body: unknown) {
  if (action === 'list') return computers.list()
  if (action === 'submit') return computers.submit(bot, body)
  if (action === 'read') return computers.read(bot, body)
  if (action === 'cancel') return computers.cancel(bot, body)
  if (action === 'copy') return computers.copy(bot, body)
  throw new Error('Unknown computer operation.')
}
