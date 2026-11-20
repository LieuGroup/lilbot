import { lazy, type ReactNode, Suspense, useState } from 'react'
import { Button } from '@/ui/button'
import type { BotThread } from '../../../shared/thread-schema'

const StopThreadDialog = lazy(() => import('./stop-thread-dialog'))

/** "Stop" on a running line or an opened exchange. It asks first; the dialog loads on the first click. */
export function StopThread({ botId, thread, className, children = 'Stop' }: { botId: string; thread: BotThread; className: string; children?: ReactNode }) {
  const [asking, setAsking] = useState(false)
  return (
    <>
      <Button variant="ghost" className={className} onClick={() => setAsking(true)}>
        {children}
      </Button>
      {asking && (
        <Suspense>
          <StopThreadDialog botId={botId} thread={thread} onClose={() => setAsking(false)} />
        </Suspense>
      )}
    </>
  )
}
