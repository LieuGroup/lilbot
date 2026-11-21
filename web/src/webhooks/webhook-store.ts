/** Each bot's webhooks (`webhooks.list`, with their newest 50 runs), kept fresh by `webhooks.changed` while the Activity
 *  tab, a webhook or a run shows them. The list never holds an address: Copy asks for it and hands it to the clipboard. */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { Webhook } from '../../../shared/webhook-schema'
import { lilbot } from '../app/lilbot-socket'
import { watchedReads } from '../app/watched-reads'

interface WebhookStore {
  byBot: Record<string, Webhook[]>
}

const useWebhookStore = create<WebhookStore>(() => ({ byBot: {} }))

/** A failed read keeps the list read before it: without one the section stays hidden, as it is for a bot with none (and
 *  on a LilBot whose helper door is off, where every read is refused). */
async function load(botId: string) {
  try {
    const webhooks = await lilbot.call('webhooks.list', { botId })
    useWebhookStore.setState(state => ({ byBot: { ...state.byBot, [botId]: webhooks } }))
  } catch {}
}

const watch = watchedReads(load, [listener => lilbot.onWebhooksChanged(listener)])

/** The bot's webhooks, oldest first; undefined until the first read. */
export function useWebhooks(botId: string) {
  useEffect(() => watch(botId), [botId])
  return useWebhookStore(state => state.byBot[botId])
}

/** Pauses or resumes a webhook; the list shows the change at once and the server's answer settles it. */
export async function setPaused(botId: string, webhook: Webhook, paused: boolean) {
  const swap = (value: boolean) =>
    useWebhookStore.setState(state => ({
      byBot: { ...state.byBot, [botId]: (state.byBot[botId] ?? []).map(item => (item.id === webhook.id ? { ...item, paused: value } : item)) }
    }))
  swap(paused)
  try {
    await lilbot.call(paused ? 'webhooks.pause' : 'webhooks.resume', { botId, id: webhook.id })
  } catch (error) {
    swap(!paused)
    throw error
  } finally {
    void load(botId)
  }
}

export async function deleteWebhook(botId: string, id: string) {
  await lilbot.call('webhooks.delete', { botId, id })
  await load(botId)
}

/** Puts the secret address on the clipboard without it ever reaching the screen, a store or a log. The clipboard item is
 *  given its pending text at once, so Safari still counts the click as the gesture that allows the write. */
export async function copyAddress(botId: string, id: string) {
  const address = lilbot.call('webhooks.address', { botId, id }).then(answer => answer.address)
  if (typeof ClipboardItem !== 'undefined' && ClipboardItem.supports?.('text/plain') !== false)
    return navigator.clipboard.write([new ClipboardItem({ 'text/plain': address.then(text => new Blob([text], { type: 'text/plain' })) })])
  return navigator.clipboard.writeText(await address)
}
