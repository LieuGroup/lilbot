import { useState } from 'react'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { Notice } from '../ui/controls'
import { useBotStore } from './bot-store'

export function PrimaryBotAction({ botId }: { botId: string }) {
  const primary = useBotStore(state => state.bots.find(bot => bot.id === botId)?.isPrimary)
  const connected = useBotStore(state => state.connected)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function makePrimary() {
    setBusy(true)
    setError('')
    try {
      await lilbot.call('bots.setPrimary', { botId })
      await useBotStore.getState().load()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-2 border-b border-border pb-6">
      {error && <Notice tone="error">{error}</Notice>}
      {primary ? (
        <p className="text-sm text-muted">Your primary bot</p>
      ) : (
        <button type="button" disabled={busy || !connected} onClick={makePrimary} className="self-start rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50">
          {busy ? 'Saving...' : 'Make primary'}
        </button>
      )}
    </section>
  )
}
