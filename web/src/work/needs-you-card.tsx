/** "Needs you" cards on Today's brief (Paper artboard 20, frame 1): question with inline reply, Oscar check, or waiting goal. */
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Notice } from '@/ui/notice'
import type { Goal } from '../../../shared/goal-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { messageOf } from '../app/lilbot-socket'
import { ThreadAvatar } from '../threads/thread-avatar'
import { elapsedShort, isOscarCheck } from './work-lines'
import { answerWorkItem } from './work-store'

const ringBlue = 'rounded-xl ring-1 ring-primary/35 px-3.5 py-3'

export function NeedsYouWorkCard({ item, now }: { item: WorkSummary; now: number }) {
  if (isOscarCheck(item)) return <OscarCheckCard item={item} />
  return <QuestionCard item={item} now={now} />
}

function QuestionCard({ item, now }: { item: WorkSummary; now: number }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    setError('')
    try {
      await answerWorkItem(item.id, trimmed)
      setText('')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={`${ringBlue} flex flex-col gap-2.5`}>
      <div className="flex items-center gap-2">
        <ThreadAvatar id={item.ownerId} name={item.ownerName} size={18} />
        <Link
          to="/work/items/$itemId"
          params={{ itemId: item.id }}
          className="min-w-0 flex-1 truncate text-[13px]/[18px] font-medium text-foreground outline-none hover:underline focus-visible:underline"
        >
          {item.title}
        </Link>
        <span className="flex-none text-xs/4 text-muted-foreground">
          {item.ownerName} asks · {elapsedShort(now - item.updatedAt, 'ago')}
        </span>
      </div>
      {item.question && <p className="text-sm/[21px] text-foreground">{item.question}</p>}
      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={`Answer ${item.ownerName}`}
          aria-label={`Answer ${item.ownerName}`}
          disabled={sending}
          className="h-8 flex-1 rounded-lg text-[13px]/[18px]"
        />
        <Button type="submit" disabled={!text.trim() || sending} className="h-8 rounded-lg px-3.5 text-[13px]/[18px] font-medium">
          {sending ? 'Sending...' : 'Send'}
        </Button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}

function OscarCheckCard({ item }: { item: WorkSummary }) {
  const reason =
    item.checkLevel === 3 ? 'Waits for your check · Level 3' : item.check?.note ? `Waits for your check · ${item.check.note}` : 'Waits for your check · review evidence and decide'
  return (
    <div className={`${ringBlue} flex items-center gap-2.5`}>
      <ThreadAvatar id={item.ownerId} name={item.ownerName} size={18} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          to="/work/items/$itemId"
          params={{ itemId: item.id }}
          className="truncate text-[13px]/[18px] font-medium text-foreground outline-none hover:underline focus-visible:underline"
        >
          {item.title}
        </Link>
        <span className="truncate text-xs/4 text-muted-foreground">{reason}</span>
      </div>
      <Link
        to="/work/items/$itemId"
        params={{ itemId: item.id }}
        className="flex-none rounded-lg px-3 py-1.5 text-[13px]/[18px] font-medium text-foreground ring-1 ring-foreground/12 outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Look
      </Link>
    </div>
  )
}

export function NeedsYouGoalCard({ goal }: { goal: Goal }) {
  const subtitle = goal.proposal ? `Goal change proposed · ${goal.proposal.why}` : 'Goal agreement waits for you'
  return (
    <div className={`${ringBlue} flex items-center gap-2.5`}>
      <ThreadAvatar id={goal.botId} name={goal.botName} size={18} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          to="/work/goals/$goalId"
          params={{ goalId: goal.id }}
          className="truncate text-[13px]/[18px] font-medium text-foreground outline-none hover:underline focus-visible:underline"
        >
          {goal.text}
        </Link>
        <span className="truncate text-xs/4 text-muted-foreground">{subtitle}</span>
      </div>
      <Link
        to="/work/goals/$goalId"
        params={{ goalId: goal.id }}
        className="flex-none rounded-lg px-3 py-1.5 text-[13px]/[18px] font-medium text-foreground ring-1 ring-foreground/12 outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Look
      </Link>
    </div>
  )
}
