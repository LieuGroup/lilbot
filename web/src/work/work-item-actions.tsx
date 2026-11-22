/** Interactive "Needs you" banners on an item's page: Oscar's Level 3 check (Pass / Send back) and question answer (Paper artboard 20, frame 5). */
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Notice } from '@/ui/notice'
import type { WorkItem } from '../../../shared/work-schema'
import { messageOf } from '../app/lilbot-socket'
import { answerWorkItem, passWorkItem, sendBackWorkItem } from './work-store'

export function OscarCheckBanner({ item }: { item: WorkItem }) {
  const [sendingBack, setSendingBack] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function pass() {
    setBusy(true)
    setError('')
    try {
      await passWorkItem(item.id)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  async function sendBack(event: React.FormEvent) {
    event.preventDefault()
    if (!reason.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await sendBackWorkItem(item.id, reason.trim())
      setSendingBack(false)
      setReason('')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-xl px-3.5 py-3 ring-1 ring-primary/35">
      <span className="text-[13px]/[18px] font-semibold text-foreground">Waits for your check · Level {item.checkLevel}</span>
      {item.result && <p className="text-sm/[21px] whitespace-pre-wrap text-foreground">{item.result}</p>}
      <p className="text-[13px]/5 text-muted-foreground">Look at the evidence below, then pass it or send it back with a reason.</p>
      {!sendingBack ? (
        <div className="flex items-center gap-2">
          <Button onClick={pass} disabled={busy} className="h-8 rounded-lg px-3.5 text-[13px]/[18px] font-medium">
            {busy ? 'Passing...' : 'Pass'}
          </Button>
          <Button variant="outline" onClick={() => setSendingBack(true)} disabled={busy} className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium">
            Send back…
          </Button>
        </div>
      ) : (
        <form onSubmit={sendBack} className="flex flex-col gap-2">
          <Input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="What needs fixing?"
            aria-label="Reason to send back"
            autoFocus
            disabled={busy}
            className="h-8 rounded-lg text-[13px]/[18px]"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={!reason.trim() || busy} className="h-8 rounded-lg px-3.5 text-[13px]/[18px] font-medium">
              {busy ? 'Sending...' : 'Send back'}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setSendingBack(false)} className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium">
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}

export function QuestionBanner({ item }: { item: WorkItem }) {
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!answer.trim() || sending) return
    setSending(true)
    setError('')
    try {
      await answerWorkItem(item.id, answer.trim())
      setAnswer('')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-xl px-3.5 py-3 ring-1 ring-primary/35">
      <span className="text-[13px]/[18px] font-semibold text-foreground">{item.ownerName} asks</span>
      {item.question && <p className="text-sm/[21px] text-foreground">{item.question}</p>}
      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          placeholder={`Answer ${item.ownerName}`}
          aria-label={`Answer ${item.ownerName}`}
          disabled={sending}
          className="h-8 flex-1 rounded-lg text-[13px]/[18px]"
        />
        <Button type="submit" disabled={!answer.trim() || sending} className="h-8 rounded-lg px-3.5 text-[13px]/[18px] font-medium">
          {sending ? 'Sending...' : 'Send'}
        </Button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}
