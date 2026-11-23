/** Delegation tools: hand work to other bots (`lilbot_delegate`) and control it or attach reply files
 *  (`lilbot_delegation`). Status calls are reads (no change record, allowed in check sessions), like `lilbot_group`. */
import { LilBotError } from '../../shared/lilbot-error'
import { AttachInput, DelegateInput, DelegationActionInput, RedirectInput } from '../../shared/thread-schema'
import { actionTool, type McpTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

export function delegationTools({ delegation: { hand, control } }: SystemDeps): McpTool[] {
  const controlTool = actionTool(
    'lilbot_delegation',
    'Control work you handed out, or attach files to an exchange answer. action: status (exchangeIds/batchId), cancel (exchangeId), redirect (exchangeId, requestId, message), wait (exchangeIds/batchId), attach (receiver: exchangeId, files).',
    DelegationActionInput,
    async (caller, raw) => {
      const { action, exchangeId, exchangeIds, batchId, requestId, message, files } = raw
      const pick = { exchangeIds: exchangeIds ?? (exchangeId ? [exchangeId] : undefined), batchId }
      if (action === 'status') return control.status(caller, pick, raw)
      if (action === 'wait') return control.wait(caller, pick, raw)
      if (action === 'cancel') {
        if (!exchangeId) throw new LilBotError('exchange_id_missing', 'Give the exchangeId to cancel.')
        return control.cancel(caller, exchangeId, raw)
      }
      if (action === 'redirect') return control.redirect(caller, RedirectInput.parse({ requestId, exchangeId, message }), raw)
      return hand.attach(caller, AttachInput.parse({ exchangeId, files }), raw)
    }
  )
  return [
    actionTool(
      'lilbot_delegate',
      'Hand work to other bots (to) or your own fresh hidden worker session (worker: true, optional model, reasoningEffort, computer and cwd), full access in parallel. Attach workspace files by path; answers arrive as new turns — never poll. Reuse requestId only on retry.',
      DelegateInput,
      (caller, input) => hand.delegate(caller, input)
    ),
    { ...controlTool, readOnly: (args: DelegationActionInput) => args.action === 'status' }
  ]
}
