import { WebhookIcon } from 'lucide-react'
import { RunTranscript } from '../routines/run-transcript'
import { useColumnNavigation } from '../threads/open-thread'
import { runTitle } from './webhook-lines'
import { useWebhooks } from './webhook-store'

/** A webhook run's transcript in the conversation column, like a routine run's: "Webhook run", when its events came and
 *  how many, and the webhook's task under "The webhook asked". The events themselves were in LilBot's prompt, which is left
 *  out like a routine's. */
export default function WebhookRunView({ botId, runId }: { botId: string; runId: string }) {
  const webhooks = useWebhooks(botId)
  const { close } = useColumnNavigation(botId, 'webhookRun')
  const webhook = webhooks?.find(candidate => candidate.runs.some(run => run.id === runId))
  const run = webhook?.runs.find(candidate => candidate.id === runId)
  return (
    <RunTranscript
      botId={botId}
      runId={runId}
      open="webhooks.openRun"
      icon={WebhookIcon}
      title="Webhook run"
      when={run && runTitle(run)}
      asked={webhook && { label: 'The webhook asked', text: webhook.description }}
      summary={run?.result || (run?.status === 'stopped' ? 'This run was stopped.' : run?.status === 'failed' ? 'This run failed.' : undefined)}
      gone={webhooks && !run ? 'This run is no longer in the webhook’s list.' : undefined}
      close={() => void close()}
    />
  )
}
