/** Which sessions are checks (#174). A check reproduces a claim from the real thing, so its session sees no memory and
 *  changes nothing through LilBot but its verdict. Both of a check's session ids are saved before its prompt runs
 *  (`work_check_chats`), and a session the engine continued after compressing one counts as it. Every check counts, a
 *  second bot's too: its shared facts can mention the work as well. */
import type { WorkCheckStore } from './work-check-store'

export const NO_MEMORY = 'This session is a check: it has no memory and no earlier conversations. Check the claim from the real thing.'
export const NO_SKILLS = 'A check of yours is under way, and a skill change cannot say which session it comes from: skills are not changed meanwhile. Try again once it ends.'
export const NO_CHANGES = 'This session is a check: LilBot lets it read and give its verdict, nothing else.'
export type CheckUse = 'memory' | 'skills' | 'changes'

/** `rootOf`: the session a chat's compression lineage began as, null while it cannot be read (`bots/hidden-chats.ts`). */
export function checkSessions(checks: Pick<WorkCheckStore, 'checkOfChat' | 'running'>, rootOf: (botId: string, chatId: string) => string | null) {
  /** Whether a check of this bot is under way, so one of its calls may come from a check session. */
  const checking = (botId: string) => checks.running().some(check => check.by.id === botId)
  /** Whether this session is a check. While its lineage cannot be read it counts as one when the bot is checking. */
  const isCheck = (botId: string, chatId: string): boolean => {
    if (checks.checkOfChat(chatId)) return true
    const root = rootOf(botId, chatId)
    if (root === null) return checking(botId)
    return root !== chatId && checks.checkOfChat(root) !== null
  }
  return {
    checking,
    isCheck,
    /** Why this call is refused because it may come from a check session, or null. A call that names no session is
     *  refused while the bot checks. */
    refusal(botId: string, chatId: string | undefined, use: CheckUse): string | null {
      if (!(chatId ? isCheck(botId, chatId) : checking(botId))) return null
      if (use === 'memory') return NO_MEMORY
      if (use === 'skills') return NO_SKILLS
      return NO_CHANGES
    }
  }
}

export type CheckSessions = ReturnType<typeof checkSessions>
