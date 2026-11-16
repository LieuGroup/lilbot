/** Audit API for the future Reports UI (needs-ui). Newest first; pass the last id to page. */
import { lilbot } from '@/app/lilbot-socket'
export const reportsClient = {
  list: (before?: string, limit = 100) => lilbot.call('reports.list', { before, limit }),
  onChanged: (listener: () => void) => lilbot.onReportsChanged(listener)
}
