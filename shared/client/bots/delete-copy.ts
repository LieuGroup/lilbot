/** The sentences of the delete dialog and the Settings rows. Pure, so plurals are tested. */
import type { BotDeleteDefaults } from '../../bot-delete-schema'

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What always goes, and what always stays. `routines` is unknown while it loads. */
export function deleteSummary(routines: number | null): string {
  const removed = !routines
    ? 'Its conversation is removed.'
    : routines === 1
      ? 'Its conversation and its routine are removed.'
      : `Its conversation and its ${routines} routines are removed.`
  return `${removed} Anything it shared with your other bots stays.`
}

/** The line under "Files", in the dialog (about this bot) or in Settings (about any bot). */
export function filesHint(choice: BotDeleteDefaults['files'], place: 'dialog' | 'settings'): string {
  if (place === 'settings') return choice === 'archive' ? 'Move the folder to the archive' : 'Delete the folder for good'
  return choice === 'archive' ? 'Its folder moves to the archive' : 'Its folder is deleted for good'
}

/** The line under "Private memories". `facts` is this bot's count, unknown in Settings. */
export function memoriesHint(choice: BotDeleteDefaults['privateMemories'], facts: number | null): string {
  if (facts === null) return choice === 'forget' ? 'Forget them, restorable in Memory' : 'Keep them as they are'
  if (facts === 0) return 'It has no private memories'
  const subject = count(facts, 'fact is', 'facts are')
  return choice === 'forget' ? `${subject} forgotten, restorable` : `${subject} kept`
}
