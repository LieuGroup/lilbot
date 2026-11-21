import type { Webhook } from '../../../shared/webhook-schema'
import { ConfirmDeleteDialog } from '../routines/confirm-delete-dialog'
import { useWebhookNavigation } from './open-webhook'
import { deleteText } from './webhook-lines'
import { deleteWebhook } from './webhook-store'

/** "Delete this webhook?" (Paper "17 Skills and webhooks" frame 6): the address stops at once and the runs go; the sender
 *  keeps calling until it is removed there. Back to the Activity tab after. */
export function DeleteWebhookDialog({ botId, webhook, onClose }: { botId: string; webhook: Webhook; onClose: () => void }) {
  const { close } = useWebhookNavigation()
  const confirm = async () => {
    await deleteWebhook(botId, webhook.id)
    onClose()
    await close()
  }
  return (
    <ConfirmDeleteDialog title="Delete this webhook?" action="Delete" confirm={confirm} onClose={onClose}>
      {deleteText(webhook)}
    </ConfirmDeleteDialog>
  )
}
