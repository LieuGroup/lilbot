/** Work item line in a bot's conversation (Paper artboard 20, frame 6): bordered row linking to the item's page. */
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { WorkSummary } from '../../../shared/work-schema'
import { CheckBadge } from './check-badge'
import { WorkIcon } from './work-nav-row'
import { useBotWorkItems } from './work-store'

function lineStatus(item: WorkSummary, children: WorkSummary[]): string {
  const parts = children.length > 0 ? ` · ${children.length} ${children.length === 1 ? 'part' : 'parts'}, ${children.filter(c => c.status === 'done').length} done` : ''
  switch (item.status) {
    case 'open':
      return `Open${parts}`
    case 'working':
      return `Working${parts}`
    case 'checking':
      return 'Being checked'
    case 'needs_oscar':
      return 'Needs you'
    case 'done':
      return `Finished${parts}`
    case 'failed':
      return 'Failed'
    case 'dropped':
      return 'Dropped'
  }
}

export default function WorkLine({ botId, workItemId, fallback }: { botId: string; workItemId: string; fallback: ReactNode }) {
  const items = useBotWorkItems(botId)
  const item = items?.find(candidate => candidate.id === workItemId)
  if (!items || !item) return fallback
  const children = items.filter(candidate => candidate.parentId === item.id)
  return (
    <Link
      to="/work/items/$itemId"
      params={{ itemId: item.id }}
      className="flex items-center gap-2.5 rounded-[10px] py-[9px] pr-2.5 pl-3 ring-1 ring-hairline outline-none transition-colors hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <WorkIcon className="size-4 flex-none text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px]/[18px] font-medium text-foreground">Work · {item.title}</span>
        <span className="truncate text-xs/4 text-muted-foreground">{lineStatus(item, children)}</span>
      </div>
      <CheckBadge item={item} />
      <ChevronRightIcon aria-hidden className="size-3.5 flex-none text-foreground/40" strokeWidth={1.75} />
    </Link>
  )
}
