/** "All work" tab on the Work board: by status or by bot, with bot and time filters (Paper artboard 20, frame 3). */
import { useMemo, useState } from 'react'
import { Notice } from '@/ui/notice'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { useNow } from '../app/use-now'
import { useBotStore } from '../bots/bot-store'
import { groupByBot, groupByStatus } from './work-groups'
import { TreeRows, WorkRow } from './work-row'
import { useWorkList } from './work-store'

type Mode = 'status' | 'bot'
type WindowKey = '1d' | '7d' | '30d' | 'all'

const WINDOWS: { id: WindowKey; label: string; ms: number | null }[] = [
  { id: '1d', label: 'Today', ms: 86_400_000 },
  { id: '7d', label: '7 days', ms: 7 * 86_400_000 },
  { id: '30d', label: '30 days', ms: 30 * 86_400_000 },
  { id: 'all', label: 'All time', ms: null }
]

export default function WorkAllPage() {
  const now = useNow(30_000)
  const bots = useBotStore(state => state.bots)
  const [mode, setMode] = useState<Mode>('status')
  const [botId, setBotId] = useState('all')
  const [windowKey, setWindowKey] = useState<WindowKey>('7d')
  const [showAllDone, setShowAllDone] = useState(false)
  const [showOther, setShowOther] = useState(false)

  const from = useMemo(() => {
    const ms = WINDOWS.find(w => w.id === windowKey)?.ms ?? null
    return ms ? Math.floor((Date.now() - ms) / 60_000) * 60_000 : undefined
  }, [windowKey])

  const { list, loaded, error } = useWorkList(botId === 'all' ? undefined : botId, from)
  const byStatus = useMemo(() => groupByStatus(list), [list])
  const byBot = useMemo(() => groupByBot(list), [list])
  const visibleDone = showAllDone ? byStatus.done : byStatus.done.slice(0, 6)
  const hiddenDone = byStatus.done.length - visibleDone.length

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3 px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        <div role="tablist" aria-label="Group work by" className="flex rounded-lg bg-foreground/6 p-0.5">
          {(['status', 'bot'] as const).map(value => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-md px-2.5 py-[3px] text-xs/4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                mode === value ? 'bg-card font-medium text-foreground ring-1 ring-hairline' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {value === 'status' ? 'By status' : 'By bot'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Select value={botId} onValueChange={v => v && setBotId(v)}>
          <SelectTrigger size="sm" aria-label="Filter by bot" className="h-7 rounded-lg text-xs/4 font-medium">
            <SelectValue>{botId === 'all' ? 'All bots' : (bots.find(b => b.id === botId)?.name ?? botId)}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All bots</SelectItem>
            {bots.map(bot => (
              <SelectItem key={bot.id} value={bot.id}>
                {bot.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={windowKey} onValueChange={v => v && setWindowKey(v as WindowKey)}>
          <SelectTrigger size="sm" aria-label="Filter by time" className="h-7 rounded-lg text-xs/4 font-medium">
            <SelectValue>{WINDOWS.find(w => w.id === windowKey)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {WINDOWS.map(w => (
              <SelectItem key={w.id} value={w.id}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!loaded && !error && <p className="px-2 py-3 text-[13px] text-muted-foreground">Loading work...</p>}
      {loaded && list.length === 0 && <p className="px-2 py-4 text-[13px] text-muted-foreground">No work items in this window.</p>}

      {mode === 'status' && list.length > 0 && (
        <div className="flex flex-col gap-1">
          {byStatus.needsOscar.length > 0 && (
            <Section title={`Needs you · ${byStatus.needsOscar.length}`}>
              {byStatus.needsOscar.map(item => (
                <WorkRow key={item.id} item={item} now={now} emphasis />
              ))}
            </Section>
          )}
          {byStatus.working.length > 0 && (
            <Section title={`Working · ${byStatus.workingCount}`}>
              {byStatus.working.map(row => (
                <TreeRows key={row.item.id} row={row} now={now} />
              ))}
            </Section>
          )}
          {byStatus.done.length > 0 && (
            <Section title={`Done · ${byStatus.done.length}`}>
              {visibleDone.map(item => (
                <WorkRow key={item.id} item={item} now={now} />
              ))}
            </Section>
          )}
          {(hiddenDone > 0 || byStatus.failed.length > 0 || byStatus.dropped.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 pt-2 text-xs/4 font-medium text-muted-foreground">
              {hiddenDone > 0 && (
                <button type="button" onClick={() => setShowAllDone(true)} className="hover:text-foreground hover:underline">
                  {hiddenDone} more
                </button>
              )}
              {(byStatus.failed.length > 0 || byStatus.dropped.length > 0) && (
                <button type="button" onClick={() => setShowOther(v => !v)} className="hover:text-foreground hover:underline">
                  {[byStatus.failed.length ? `Failed ${byStatus.failed.length}` : '', byStatus.dropped.length ? `Dropped ${byStatus.dropped.length}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </button>
              )}
            </div>
          )}
          {showOther && byStatus.failed.length > 0 && (
            <Section title={`Failed · ${byStatus.failed.length}`}>
              {byStatus.failed.map(item => (
                <WorkRow key={item.id} item={item} now={now} />
              ))}
            </Section>
          )}
          {showOther && byStatus.dropped.length > 0 && (
            <Section title={`Dropped · ${byStatus.dropped.length}`}>
              {byStatus.dropped.map(item => (
                <WorkRow key={item.id} item={item} now={now} />
              ))}
            </Section>
          )}
        </div>
      )}

      {mode === 'bot' && list.length > 0 && (
        <div className="flex flex-col gap-2">
          {byBot.map(group => (
            <Section key={group.botId} title={`${group.botName} · ${group.items.length}`}>
              {group.items.map(item => (
                <WorkRow key={item.id} item={item} now={now} emphasis={item.status === 'needs_oscar'} />
              ))}
            </Section>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col pt-1.5">
      <h3 className="px-2 pb-1 text-xs/4 text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}
