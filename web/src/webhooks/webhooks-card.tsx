import { Fragment, useState } from 'react'
import { Switch } from '@/ui/switch'
import type { Webhook } from '../../../shared/webhook-schema'
import { messageOf } from '../app/lilbot-socket'
import { useNow } from '../app/use-now'
import { StatusIcon } from '../bots/status-icon'
import { useWebhookNavigation } from './open-webhook'
import { webhookLine } from './webhook-lines'
import { setPaused, useWebhooks } from './webhook-store'

const hint = 'px-2 pt-0.5 text-xs/4 text-muted-foreground'

/** The Activity tab's "Webhooks" section under Routines (Paper "17 Skills and webhooks" frame 4): each webhook's task on one
 *  line, its source and last event under it, and its switch. A row opens the webhook. Hidden while the bot has none:
 *  webhooks are made by asking the bot. */
export function WebhooksCard({ botId, botName }: { botId: string; botName: string }) {
  const webhooks = useWebhooks(botId)
  const [failure, setFailure] = useState('')
  const now = useNow(30_000)
  if (!webhooks?.length) return null
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex justify-between px-2 text-xs/4 text-muted-foreground">
        <span>Webhooks</span>
        <span>{webhooks.length}</span>
      </h3>
      <div className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">
        {webhooks.map((webhook, index) => (
          <Fragment key={webhook.id}>
            {index > 0 && <div className="h-px bg-foreground/6" />}
            <Row botId={botId} webhook={webhook} now={now} onFailure={setFailure} />
          </Fragment>
        ))}
      </div>
      {failure && <p className={`${hint} text-destructive`}>{failure}</p>}
      <p className={hint}>Ask {botName} in the chat to watch something.</p>
    </section>
  )
}

function Row({ botId, webhook, now, onFailure }: { botId: string; webhook: Webhook; now: number; onFailure: (text: string) => void }) {
  const { open } = useWebhookNavigation()
  const line = webhookLine(webhook, now)
  return (
    <div className="flex items-center gap-3 pr-3 first:rounded-t-lg last:rounded-b-lg hover:bg-foreground/4">
      <button
        type="button"
        onClick={() => void open(webhook.id)}
        className="flex min-w-0 flex-1 flex-col py-2.5 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={`truncate text-[13px]/[18px] font-medium ${line.tone === 'paused' ? 'text-muted-foreground' : ''}`}>{webhook.description}</span>
        <span className="flex min-w-0 items-center gap-[5px]">
          {line.tone === 'running' && <StatusIcon tone="working" />}
          <span className={`truncate text-xs/4 ${line.tone === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{line.text}</span>
        </span>
      </button>
      <WebhookSwitch botId={botId} webhook={webhook} onFailure={onFailure} />
    </div>
  )
}

/** On while the webhook takes events; off pauses it, and its address answers that it is paused. */
export function WebhookSwitch({ botId, webhook, onFailure }: { botId: string; webhook: Webhook; onFailure: (text: string) => void }) {
  const change = (on: boolean) => {
    onFailure('')
    setPaused(botId, webhook, !on).catch(failure => onFailure(`Could not ${on ? 'resume' : 'pause'} it. ${messageOf(failure)}`))
  }
  return <Switch checked={!webhook.paused} onCheckedChange={change} aria-label={webhook.paused ? 'Resume this webhook' : 'Pause this webhook'} />
}
