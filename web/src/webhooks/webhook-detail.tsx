import { ChevronLeftIcon, Trash2Icon } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/ui/button'
import { Fact } from '@/ui/fact'
import { iconButton } from '@/ui/icon-button'
import { useNow } from '../app/use-now'
import { useBotStore } from '../bots/bot-store'
import { sessionTime } from '../history/history-labels'
import { RunList } from '../routines/run-list'
import { DeleteWebhookDialog } from './delete-webhook-dialog'
import { useWebhookNavigation } from './open-webhook'
import { createdText, runTitle } from './webhook-lines'
import { copyAddress, useWebhooks } from './webhook-store'
import { WebhookSwitch } from './webhooks-card'

const note = 'px-2 text-xs/4 text-muted-foreground'

/** One webhook, in place of the whole details panel (Paper "17 Skills and webhooks" frame 5): a 52px bar with "Activity"
 *  and Delete, the full task with its switch, the facts with Copy for the address, and the runs. The address is a secret:
 *  it goes to the clipboard and is never drawn. */
export default function WebhookDetail({ botId, webhookId }: { botId: string; webhookId: string }) {
  const webhooks = useWebhooks(botId)
  const botName = useBotStore(state => state.bots.find(bot => bot.id === botId)?.name ?? 'The bot')
  const { close } = useWebhookNavigation()
  const [deleting, setDeleting] = useState(false)
  const [failure, setFailure] = useState('')
  const now = useNow(30_000)
  const webhook = webhooks?.find(candidate => candidate.id === webhookId)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center justify-between pt-[env(safe-area-inset-top)] pr-2.5 pl-2">
        <Button variant="ghost" className="h-auto gap-0.5 rounded-md py-[5px] pr-2 pl-1 text-[13px]/[18px] font-medium hover:bg-foreground/4" onClick={() => void close()}>
          <ChevronLeftIcon className="size-4" strokeWidth={1.75} />
          Activity
        </Button>
        {webhook && (
          <Button variant="ghost" size="icon-sm" className={iconButton()} onClick={() => setDeleting(true)} aria-label="Delete this webhook" title="Delete this webhook">
            <Trash2Icon />
          </Button>
        )}
      </div>
      {!webhook ? (
        <p className="px-5 py-2 text-[13px]/[18px] text-muted-foreground">{webhooks ? 'This webhook was deleted.' : 'Loading...'}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-1 pb-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start gap-3 px-2">
              <p className={`flex-1 text-sm/[21px] font-medium break-words whitespace-pre-wrap ${webhook.paused ? 'text-muted-foreground' : ''}`}>{webhook.description}</p>
              <span className="flex h-[21px] items-center">
                <WebhookSwitch botId={botId} webhook={webhook} onFailure={setFailure} />
              </span>
            </div>
            {failure && <p className={`${note} text-destructive`}>{failure}</p>}
          </div>
          <dl className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">
            <Fact label="From" value={webhook.source} />
            <Fact label="Last event" value={webhook.lastEventAt === null ? 'No events yet' : sessionTime(webhook.lastEventAt, now)} />
            <Fact label="Created" value={createdText(webhook, botName)} />
            <AddressRow botId={botId} id={webhook.id} />
          </dl>
          <RunList botId={botId} runs={webhook.runs} title={run => runTitle(run, now)} column="webhookRun" />
          <p className={note}>Events that arrive close together are handled in one run. The address is a secret: anyone who has it can wake this bot.</p>
        </div>
      )}
      {deleting && webhook && <DeleteWebhookDialog botId={botId} webhook={webhook} onClose={() => setDeleting(false)} />}
    </div>
  )
}

/** "Address" with Copy: the address is fetched on the click and written to the clipboard; the button says what happened. */
function AddressRow({ botId, id }: { botId: string; id: string }) {
  const [label, setLabel] = useState('Copy')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = (text: string) => {
    setLabel(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setLabel('Copy'), 2000)
  }
  const copy = () =>
    copyAddress(botId, id).then(
      () => show('Copied'),
      () => show('Could not copy')
    )
  return (
    <div className="flex items-center justify-between gap-3 border-t border-foreground/6 py-[7px] pr-2 pl-3">
      <dt className="text-[13px]/[18px] text-muted-foreground">Address</dt>
      <dd>
        <Button variant="ghost" className="h-auto rounded-lg px-2.5 py-1 text-xs/4 font-medium ring-1 ring-foreground/12 hover:bg-foreground/4" onClick={copy}>
          {label}
        </Button>
      </dd>
    </div>
  )
}
