import { StarIcon } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Notice } from '@/ui/notice'
import { lilbot, messageOf } from '../app/lilbot-socket'
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
    <section className="flex flex-col gap-2">
      {error && <Notice tone="error">{error}</Notice>}
      {primary ? (
        <Badge variant="secondary" className="h-7 px-2.5 text-sm">
          <StarIcon className="fill-current" />
          Your primary bot
        </Badge>
      ) : (
        <Button variant="outline" size="lg" className="self-start" disabled={busy || !connected} onClick={makePrimary}>
          <StarIcon />
          {busy ? 'Saving...' : 'Make primary'}
        </Button>
      )}
    </section>
  )
}
