import type { ReactNode } from 'react'

import { Label } from '@/ui/label'

/** A labelled form control with an optional hint below it. `htmlFor` names the control's id. */
export function FormField({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}
