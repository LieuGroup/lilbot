import { cn } from 'cn'

import { Progress } from '@/ui/progress'
import type { BotContext } from '../../../shared/bot-schema'
import { useBotStore } from '../bots/bot-store'
import { contextDetailView } from './usage-format'

/** Context occupancy card shown in Setup under the model (Paper artboard 21, frame 6). */
export function SetupContextCard({ botId, fallback }: { botId: string; fallback?: BotContext }) {
  const context = useBotStore(state => state.bots.find(candidate => candidate.id === botId)?.context) ?? fallback
  const view = contextDetailView(context)
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-3.5 ring-1 ring-hairline">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">Context</span>
        {view.percentLabel && <span className="text-xs text-muted-foreground tabular-nums">{view.percentLabel}</span>}
      </div>
      {view.barValue !== null && <Progress value={view.barValue} aria-label="Context used" />}
      <span className={cn('text-[13px]/4 tabular-nums', view.empty ? 'text-muted-foreground' : 'text-foreground')}>{view.countLine}</span>
    </div>
  )
}
