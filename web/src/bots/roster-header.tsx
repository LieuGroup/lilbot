import { Link } from '@tanstack/react-router'
import { PlusIcon, SearchIcon, XIcon } from 'lucide-react'

import { Button } from '@/ui/button'
import { iconButton } from '@/ui/icon-button'
import { Input } from '@/ui/input'

/** The app icon and name, then search and new bot. Search turns the name into a filter box. */
export function RosterHeader({ query, onQuery }: { query: string | null; onQuery: (query: string | null) => void }) {
  return (
    <div className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center justify-between gap-2 pt-[env(safe-area-inset-top)] pr-2.5 pl-4">
      {query === null ? (
        <div className="flex items-center gap-2">
          <img src="/favicon-32.png" srcSet="/favicon-32.png 1x, /icon-192.png 2x" alt="" className="size-[22px] rounded-[6px]" />
          <span className="text-sm/5 font-semibold tracking-[-0.01em]">LilBot</span>
        </div>
      ) : (
        <Input
          autoFocus
          type="search"
          aria-label="Search bots"
          placeholder="Search bots"
          value={query}
          onChange={event => onQuery(event.target.value)}
          onKeyDown={event => event.key === 'Escape' && onQuery(null)}
          className="h-7 flex-1 rounded-[6px] border-hairline bg-card px-2 text-base md:text-[13px] dark:bg-card"
        />
      )}
      <div className="flex flex-none items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          className={iconButton({ on: query !== null })}
          aria-label={query === null ? 'Search bots' : 'Close search'}
          onClick={() => onQuery(query === null ? '' : null)}
        >
          {query === null ? <SearchIcon /> : <XIcon />}
        </Button>
        <Link to="/bots/new" className={iconButton()} aria-label="New bot" title="New bot">
          <PlusIcon />
        </Link>
      </div>
    </div>
  )
}
