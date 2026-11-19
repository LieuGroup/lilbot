import { Notice } from '@/ui/notice'

/** Show the last deployment failure again when the browser reconnects after recovery. */
export function DeployNotice({ notice }: { notice?: string }) {
  return notice ? (
    <div className="px-2 pb-2">
      <Notice tone="error">{notice}</Notice>
    </div>
  ) : null
}
