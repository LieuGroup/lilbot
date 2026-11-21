import { ChevronRightIcon, FolderIcon } from 'lucide-react'
import { Fragment, lazy, Suspense, useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import type { LibraryItem } from '../../../shared/library-schema'
import { useNow } from '../app/use-now'
import { useBotStore } from '../bots/bot-store'
import { FILTERS, groupItems, type LibraryFilter } from './library-lines'
import { LibraryRow } from './library-row'
import { useFolderNavigation } from './open-folder'
import { useLibrary } from './use-library'

// The viewer loads on the first item opened.
const LibraryViewer = lazy(() => import('./library-viewer'))
const hint = 'px-2 text-xs/4 text-muted-foreground'

/** The Library tab (Paper "08 Library" panel 1): only what the bot gave Oscar, newest first, filtered by All, Media or
 *  Files and grouped Today, This week and Older. "Browse the whole workspace" stays at the bottom. */
export function LibraryTab({ botId }: { botId: string }) {
  const name = useBotStore(state => state.bots.find(bot => bot.id === botId)?.name ?? 'This bot')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [open, setOpen] = useState<LibraryItem>()
  const { page, error, more, loadingMore } = useLibrary(botId, filter)
  const folders = useFolderNavigation()
  const now = useNow(60_000)
  return (
    <div className="flex min-h-full flex-col gap-4 px-3 pt-1 pb-3">
      <ToggleGroup aria-label="Show" value={[filter]} onValueChange={([next]) => next && setFilter(next as LibraryFilter)} className="gap-1.5 rounded-none bg-transparent p-0 px-1">
        {FILTERS.map(item => (
          <ToggleGroupItem
            key={item.id}
            value={item.id}
            className="rounded-full px-2.5 py-1 text-xs/4 text-foreground ring-1 ring-foreground/12 ring-inset data-pressed:bg-foreground data-pressed:text-background data-pressed:shadow-none data-pressed:ring-0"
          >
            {item.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {!page ? (
        <p className={error ? `${hint} text-destructive` : hint}>{error || 'Loading...'}</p>
      ) : page.items.length === 0 ? (
        <p className={hint}>{filter === 'all' ? `Nothing here yet. When ${name} hands you a file, it appears here.` : 'Nothing of this kind yet.'}</p>
      ) : (
        groupItems(page.items, now).map((group, index, groups) => (
          <section key={group.title} className="flex flex-col gap-1.5">
            <h3 className={hint}>{group.title}</h3>
            <div className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">
              {group.items.map((item, row) => (
                <Fragment key={item.id}>
                  {row > 0 && <div className="h-px bg-foreground/6" />}
                  <LibraryRow item={item} now={now} onOpen={setOpen} />
                </Fragment>
              ))}
            </div>
            {index === groups.length - 1 && page.nextOffset !== null && (
              <button type="button" disabled={loadingMore} onClick={() => void more()} className={`${hint} w-fit pt-1 font-medium hover:text-foreground`}>
                {loadingMore ? 'Loading...' : 'Show more'}
              </button>
            )}
          </section>
        ))
      )}
      {page && error && <p className={`${hint} text-destructive`}>{error}</p>}
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => void folders.open('')}
        className="flex items-center gap-2.5 rounded-lg bg-card px-3 py-2.5 text-left ring-1 ring-hairline outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FolderIcon className="size-[15px] flex-none text-muted-foreground" strokeWidth={1.75} />
        <span className="flex-1 text-[13px]/[18px]">Browse the whole workspace</span>
        <ChevronRightIcon className="size-3.5 flex-none text-foreground/40" strokeWidth={1.75} />
      </button>
      {open && (
        <Suspense>
          <LibraryViewer botId={botId} item={open} onClose={() => setOpen(undefined)} />
        </Suspense>
      )}
    </div>
  )
}
