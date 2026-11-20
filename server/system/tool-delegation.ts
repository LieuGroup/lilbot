/** Delegation tools: hand work to other bots and keep control of it. Each calls `DelegationService`, which uses the
 *  same exchanges, stop and records as the screens (`threads.list`, `threads.open`, `threads.cancel`). */
import { z } from 'zod'
import { AttachInput, DelegateInput, RedirectInput } from '../../shared/thread-schema'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

const exchangeId = z.string().min(1).max(100)
const Pick = z.object({ exchangeIds: z.array(exchangeId).max(20).optional(), batchId: z.string().max(100).optional() })

export function delegationTools({ delegation }: SystemDeps): McpTool[] {
  return [
    actionTool(
      'lilbot_delegate',
      'Hand work to other bots: each does it for real as itself, with full access (commands, files, coding through T3 Code, routines, computers). One task per bot; several run at once, one exchange each, as one batch. Attach files from your folder by path. Answers come back later as new turns here: never poll. Reuse requestId only when retrying.',
      DelegateInput,
      (caller, input) => delegation.delegate(caller, input)
    ),
    readTool(
      'lilbot_delegation_status',
      'Work you handed out: waiting, working (what the bot is doing, for how long), finished, failed or cancelled, the files passed and the latest answer. By exchange or batch; by default what is under way and the latest.',
      Pick,
      (caller, pick) => delegation.status(caller, pick)
    ),
    actionTool(
      'lilbot_delegation_cancel',
      'Stop work you handed out. The other bot stops at once; a late answer stays in the record and is not sent to you.',
      z.object({ exchangeId }),
      (caller, { exchangeId }) => delegation.cancel(caller, exchangeId)
    ),
    actionTool(
      'lilbot_delegation_redirect',
      'Change the course of work you handed out without starting over: the other bot gets your message at its next step, or with its next turn.',
      RedirectInput,
      (caller, input) => delegation.redirect(caller, input)
    ),
    actionTool('lilbot_delegation_wait', 'Be told once all these exchanges are in. Returns at once; each answer still arrives on its own.', Pick, (caller, pick) =>
      delegation.wait(caller, pick)
    ),
    actionTool('lilbot_delegation_attach', 'Send files from your folder back with your answer, while you work on an exchange another bot gave you.', AttachInput, (caller, input) =>
      delegation.attach(caller, input)
    )
  ]
}
