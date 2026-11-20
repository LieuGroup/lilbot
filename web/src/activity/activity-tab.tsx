import { CopyIcon, FolderIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Button } from '@/ui/button'
import { useNow } from '../app/use-now'
import { useBotStore } from '../bots/bot-store'
import { rowState } from '../bots/row-state'
import { StatusIcon } from '../bots/status-icon'
import { WithOtherBots } from '../threads/with-other-bots'
import { formatElapsed } from './activity-since'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-2 text-xs text-muted-foreground">{title}</h3>
      <div className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">{children}</div>
    </section>
  )
}

/** The Activity tab: what the bot is doing now, its work with other bots, its routines, and its folder. */
export function ActivityTab({ botId }: { botId: string }) {
  const bot = useBotStore(state => state.bots.find(candidate => candidate.id === botId))
  const since = useBotStore(state => state.since[botId])
  const now = useNow(15_000)
  const [copied, setCopied] = useState('')
  if (!bot) return null
  const state = rowState(bot)
  const title = state.tone === 'idle' ? 'Idle' : state.text
  const machine = bot.activity?.machine ?? 'leader'
  const meta = `${since !== undefined && state.tone !== 'idle' ? `${formatElapsed(now - since)} · ` : ''}on ${machine}`

  const copyFolder = async () => {
    try {
      await navigator.clipboard.writeText(bot.workspace)
      setCopied('Copied')
    } catch {
      setCopied('Could not copy')
    }
    setTimeout(() => setCopied(''), 2000)
  }

  return (
    <div className="flex flex-col gap-5 px-3 pt-1 pb-4">
      <Card title="Now">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <StatusIcon tone={state.tone} className="size-3.5" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className={`truncate text-[13px]/[18px] font-medium ${state.tone === 'failed' ? 'text-destructive' : ''}`}>{title}</span>
            <span className="text-xs text-muted-foreground">{meta}</span>
          </div>
        </div>
      </Card>
      <WithOtherBots botId={botId} />
      {/* Placeholder: the Routines card is designed under #10. */}
      <Card title="Routines">
        <p className="px-3 py-2.5 text-[13px]/[18px] text-muted-foreground">Scheduled work for {bot.name} will show here.</p>
      </Card>
      <Card title="Workspace">
        <Button
          variant="ghost"
          className="h-auto justify-start gap-2.5 rounded-lg px-3 py-2.5 text-left font-normal hover:bg-foreground/4"
          onClick={copyFolder}
          title={bot.workspace}
        >
          <FolderIcon className="size-[15px] text-muted-foreground" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-[13px]/[18px]">{copied || bot.workspace}</span>
          <CopyIcon className="size-3.5 text-foreground/40" strokeWidth={1.75} />
          <span className="sr-only">Copy the folder path</span>
        </Button>
      </Card>
    </div>
  )
}
