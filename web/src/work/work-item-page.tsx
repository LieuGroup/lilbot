/** Full page for one work item: result, definition of done, check level, evidence, checks and links (Paper artboard 20, frames 4-5). */
import { Link, useParams, useRouter } from '@tanstack/react-router'
import { ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { Notice } from '@/ui/notice'
import type { WorkCheck } from '../../../shared/work-check-schema'
import { FINAL_WORK, type WorkItem } from '../../../shared/work-schema'
import { useNow } from '../app/use-now'
import { DropWorkDialog } from './drop-work-dialog'
import { EvidenceCard } from './evidence-card'
import { WorkItemBanner } from './work-item-banner'
import { askedByLabel, checkerLabel, itemTimestamp, levelDescription, levelReason } from './work-lines'
import { WorkRow } from './work-row'
import { dropWorkItem, useWorkItem } from './work-store'

export default function WorkItemPage() {
  const { itemId } = useParams({ from: '/work/items/$itemId' })
  const router = useRouter()
  const now = useNow(30_000)
  const { item, error } = useWorkItem(itemId)
  const [dropping, setDropping] = useState(false)

  const goBack = () => {
    if (window.history.length > 1) router.history.back()
    else void router.navigate({ to: '/work' })
  }

  if (!item) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-[52px] flex-none items-center justify-between border-b border-hairline px-5">
          <span className="text-sm/5 font-semibold">Work item</span>
          <button type="button" onClick={goBack} className="rounded-lg px-2.5 py-[5px] text-[13px]/[18px] font-medium ring-1 ring-foreground/12 hover:bg-foreground/4">
            Back
          </button>
        </header>
        <div className="mx-auto w-full max-w-[640px] px-5 py-5 text-[13px] text-muted-foreground">{error ? <Notice tone="error">{error}</Notice> : 'Loading item...'}</div>
      </div>
    )
  }

  const canDrop = !FINAL_WORK.includes(item.status)
  const ownerEvidence = item.evidence.filter(e => e.byId === item.ownerId)
  const settledChecks = item.checks.filter(c => c.state !== 'checking' || c.by.kind !== 'oscar')

  const headerBtn =
    'rounded-lg px-2.5 py-[5px] text-[13px]/[18px] font-medium text-foreground ring-1 ring-foreground/12 outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center justify-between gap-3 border-b border-hairline pt-[env(safe-area-inset-top)] pr-3 pl-5">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-sm/5 font-semibold tracking-[-0.01em] text-foreground">{item.title}</h1>
          <p className="truncate text-xs/4 text-muted-foreground">
            {item.ownerName} · {askedByLabel(item.askedBy)} · {itemTimestamp(item.createdAt, now)}
          </p>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {canDrop && (
            <button type="button" onClick={() => setDropping(true)} className={headerBtn}>
              Drop…
            </button>
          )}
          <button type="button" onClick={goBack} className={headerBtn}>
            Back
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[640px] flex-col gap-4 px-5 pt-4 pb-6">
          {error && <Notice tone="error">{error}</Notice>}
          <WorkItemBanner item={item} now={now} />

          <section className="flex flex-col gap-1">
            <h2 className="text-xs/4 text-muted-foreground">Done means</h2>
            <p className="text-sm/[21px] whitespace-pre-wrap text-foreground">{item.done || 'Not written yet.'}</p>
          </section>

          <section className="flex flex-col gap-1">
            <h2 className="text-xs/4 text-muted-foreground">Check</h2>
            <div className="flex items-center gap-2">
              <span className="rounded-md px-[7px] py-px text-xs/4 font-semibold text-foreground ring-1 ring-foreground/20">Level {item.checkLevel}</span>
              <span className="text-[13px]/[18px] text-foreground">{levelDescription(item.checkLevel)}</span>
            </div>
            <p className="text-xs/4 text-muted-foreground">{levelReason(item)}</p>
          </section>

          {ownerEvidence.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h2 className="text-xs/4 text-muted-foreground">
                Evidence from {item.ownerName} · {ownerEvidence.length}
              </h2>
              <EvidenceCard botId={item.ownerId} entries={ownerEvidence} now={now} />
            </section>
          )}

          {settledChecks.map(check => (
            <CheckCard key={check.round} item={item} check={check} now={now} />
          ))}

          {item.children.length > 0 && (
            <section className="flex flex-col gap-1">
              <h2 className="text-xs/4 text-muted-foreground">Parts · {item.children.length}</h2>
              <div className="flex flex-col rounded-xl py-1 ring-1 ring-hairline">
                {item.children.map(child => (
                  <WorkRow key={child.id} item={child} now={now} />
                ))}
              </div>
            </section>
          )}

          <FooterLinks item={item} />
        </div>
      </div>

      {dropping && (
        <DropWorkDialog
          title={item.title}
          hasChildren={item.children.some(c => !FINAL_WORK.includes(c.status))}
          onConfirm={async reason => {
            await dropWorkItem(item.id, reason)
            setDropping(false)
          }}
          onClose={() => setDropping(false)}
        />
      )}
    </div>
  )
}

function CheckCard({ item, check, now }: { item: WorkItem; check: WorkCheck; now: number }) {
  const ring =
    check.state === 'verified' || check.state === 'passed'
      ? 'ring-success/40'
      : check.state === 'not_verified' || check.state === 'could_not_check' || check.state === 'sent_back'
        ? 'ring-destructive/40'
        : 'ring-hairline'
  const checkerEvidence = check.by.kind === 'bot' && check.by.id !== item.ownerId ? item.evidence.filter(e => e.byId === check.by.id) : []
  const foot =
    check.by.kind === 'oscar'
      ? `Checked by you · ${itemTimestamp(check.settledAt ?? check.at, now)}`
      : check.sameBot
        ? check.note || 'Fresh isolated session · no memory · changed nothing'
        : `Chosen by LilBot, not by ${item.ownerName} · changed nothing`

  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-xs/4 text-muted-foreground">
        The check, by {checkerLabel(check, item.ownerName)}
        {item.checks.length > 1 ? ` · round ${check.round}` : ''}
      </h2>
      <div className={`flex flex-col gap-1.5 rounded-xl px-3 py-2.5 ring-1 ${ring}`}>
        {check.text && <p className="text-[13px]/5 whitespace-pre-wrap text-foreground">{check.text}</p>}
        {checkerEvidence.length > 0 && <EvidenceCard botId={check.by.id ?? item.ownerId} entries={checkerEvidence} now={now} />}
        <p className="text-xs/4 text-muted-foreground">{foot}</p>
      </div>
    </section>
  )
}

function FooterLinks({ item }: { item: WorkItem }) {
  const linkClass = 'inline-flex items-center gap-0.5 text-xs/4 font-medium text-foreground outline-none hover:underline focus-visible:underline'
  const originBot = item.origin.kind === 'exchange' && item.askedBy.kind === 'bot' && item.askedBy.id ? item.askedBy.id : item.ownerId
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <div className="flex flex-wrap items-center gap-3">
        {item.parentId && (
          <Link to="/work/items/$itemId" params={{ itemId: item.parentId }} className={linkClass}>
            Part of parent item <ChevronRightIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
          </Link>
        )}
        {item.goalId && (
          <Link to="/work/goals/$goalId" params={{ goalId: item.goalId }} className={linkClass}>
            Open the goal <ChevronRightIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
          </Link>
        )}
      </div>
      {item.origin.kind === 'exchange' || item.origin.kind === 'group' ? (
        <Link to="/bots/$botId" params={{ botId: originBot }} search={{ thread: item.origin.id }} className={linkClass}>
          {item.origin.kind === 'group' ? 'Open the group' : 'Open the exchange'} <ChevronRightIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
        </Link>
      ) : item.origin.kind === 'routine_run' ? (
        <Link to="/bots/$botId" params={{ botId: item.ownerId }} search={{ run: item.origin.id }} className={linkClass}>
          Open the run <ChevronRightIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
        </Link>
      ) : item.origin.kind === 'webhook_run' ? (
        <Link to="/bots/$botId" params={{ botId: item.ownerId }} search={{ webhookRun: item.origin.id }} className={linkClass}>
          Open the run <ChevronRightIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
        </Link>
      ) : (
        <Link to="/bots/$botId" params={{ botId: item.ownerId }} className={linkClass}>
          Open the chat <ChevronRightIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
        </Link>
      )}
    </div>
  )
}
