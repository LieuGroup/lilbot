/** Lazy goal agreement cards shown at the end of a bot's conversation when a proposal waits for Oscar (Paper artboard 20, frame 8). */
import { useState } from 'react'
import { useNow } from '../app/use-now'
import { GoalAgreementCard } from './goal-agreement-card'
import { useBotGoals } from './goal-store'

export default function GoalChatCards({ botId }: { botId: string }) {
  const now = useNow(60_000)
  const goals = useBotGoals(botId)
  const [dismissed, setDismissed] = useState<Record<string, number>>({})
  const [agreedIds, setAgreedIds] = useState<string[]>([])

  if (!goals?.length) return null
  const shown = goals.filter(g => (g.waitsForOscar && dismissed[g.id] !== g.updatedAt) || agreedIds.includes(g.id))
  if (!shown.length) return null

  return (
    <div className="flex flex-col gap-3 pt-2">
      {shown.map(goal => (
        <GoalAgreementCard
          key={goal.id}
          goal={goal}
          now={now}
          showTitle
          onAgreed={saved => setAgreedIds(ids => (ids.includes(saved.id) ? ids : [...ids, saved.id]))}
          onDismiss={goal.waitsForOscar ? () => setDismissed(prev => ({ ...prev, [goal.id]: goal.updatedAt })) : undefined}
        />
      ))}
    </div>
  )
}
