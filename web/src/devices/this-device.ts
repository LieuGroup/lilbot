/** This browser's device id: made on first use and kept in the browser, so every message says where it came from. */
import { newMessageId } from '../attachments/attachment-rules'

const KEY = 'lilbot.deviceId'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let id: string | undefined

/** Storage can be blocked (a private window): the id then lasts until the page closes. */
export function thisDeviceId(): string {
  if (id) return id
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && UUID.test(saved)) id = saved
  } catch {}
  if (!id) {
    id = newMessageId()
    try {
      localStorage.setItem(KEY, id)
    } catch {}
  }
  return id
}
