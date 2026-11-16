import type { ReactNode } from 'react'

/** The body of a details tab (Memory, Setup, ...) under the panel's avatar and tabs. The details
 *  panel scrolls it. */
export function Panel({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-8 px-4 pt-1 pb-6">{children}</div>
}
