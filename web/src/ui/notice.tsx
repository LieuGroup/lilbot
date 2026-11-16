import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Alert, AlertTitle } from '@/ui/alert'

/** A short message after an action: an error, or a confirmation such as "Saved." */
export function Notice({ tone, children }: { tone: 'error' | 'ok'; children: ReactNode }) {
  if (tone === 'error')
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle className="font-normal">{children}</AlertTitle>
      </Alert>
    )
  return (
    <Alert role="status" className="text-success">
      <CircleCheckIcon />
      <AlertTitle className="font-normal">{children}</AlertTitle>
    </Alert>
  )
}
