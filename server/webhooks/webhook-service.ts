/** What LilBot does with webhooks, for the screens, the bot tools and the door. A run reuses the routines' machinery:
 *  persisted before dispatch, one hidden session per run (`BotEngine.runRoutine`) with only what the webhook may do
 *  (`webhook-access.ts`), receipts, activity and unread through `RoutineScheduler`, and its session kept out of history
 *  and the after-chat review. */
import type { ChatEvent } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { type Webhook, type WebhookAddress, type WebhookCapability, WebhookCreate, type WebhookRun } from '../../shared/webhook-schema'
import { webhookLine } from '../devices/origin-line'
import type { RoutineHost } from '../routines/routine-service'
import { webhookRunAccess } from './webhook-access'
import { addressMatches, addressPath, claimedId } from './webhook-address'
import { deliveryKeys } from './webhook-delivery'
import { WEBHOOK_LIMITS } from './webhook-limits'
import { eventView, webhookPrompt } from './webhook-payload'
import { newSigningSecret, signatureValid } from './webhook-signature'
import type { LiveWebhook, WebhookStore } from './webhook-store'

export type Delivery = 'accepted' | 'duplicate' | 'full'

export class WebhookService {
  readonly kind = 'webhook'
  constructor(
    readonly store: WebhookStore,
    private host: RoutineHost,
    /** The engine token: addresses are MACs under it. */
    private addressKey: string,
    /** The helper door's public origin; without it no outside service can reach a webhook. */
    private origin: string | undefined,
    private changed: () => void = () => {},
    private now = Date.now,
    private t3Enabled = false
  ) {}

  private requireOrigin() {
    if (!this.origin) throw new LilBotError('webhooks_unavailable', 'Webhooks need the public door, which is not set up on this LilBot. Tell Oscar.')
    return this.origin
  }
  private address(webhook: { id: string; nonce: string }) {
    return `${this.requireOrigin()}${addressPath(this.addressKey, webhook)}`
  }
  async list(botId: string) {
    await this.host.requireBot(botId)
    return this.store.list(botId)
  }
  /** The address, and a signing secret LilBot made, are given here and by `newAddress` only. */
  async create(botId: string, raw: WebhookCreate): Promise<Webhook & WebhookAddress> {
    await this.host.requireBot(botId)
    const input = WebhookCreate.parse(raw)
    this.requireOrigin()
    const signing = input.signing ? { ...input.signing, secret: input.signing.secret ?? newSigningSecret() } : null
    const webhook = this.store.create(botId, input, signing, this.now())
    this.changed()
    const made = input.signing && !input.signing.secret
    return {
      ...webhook,
      address: this.address(this.store.addressOf(botId, webhook.id)),
      ...(made ? { signingSecret: this.store.signingSecret(botId, webhook.id) } : {})
    }
  }
  async pause(botId: string, id: string, paused: boolean) {
    await this.host.requireBot(botId)
    this.store.setPaused(botId, id, paused)
    this.changed()
    return { ok: true as const }
  }
  /** Oscar's setting only: no bot tool calls it. */
  async setCapabilities(botId: string, id: string, capabilities: WebhookCapability[]) {
    await this.host.requireBot(botId)
    this.store.setCapabilities(botId, id, capabilities)
    this.changed()
    return { ok: true as const }
  }
  async delete(botId: string, id: string) {
    await this.host.requireBot(botId)
    this.store.delete(botId, id)
    this.changed()
    return { ok: true as const }
  }
  async newAddress(botId: string, id: string): Promise<WebhookAddress> {
    await this.host.requireBot(botId)
    return { id, address: this.address(this.store.newAddress(botId, id)) }
  }
  /** For the screen's Copy button. */
  async currentAddress(botId: string, id: string) {
    await this.host.requireBot(botId)
    return { address: this.address(this.store.addressOf(botId, id)) }
  }
  async openRun(botId: string, id: string, onEvent: (event: ChatEvent) => void) {
    await this.host.requireBot(botId)
    const run = this.store.run(botId, id)
    this.store.get(botId, run.webhookId)
    if (!run.chatId) throw new LilBotError('run_pending', 'This run has no conversation.')
    return this.host.openChat(botId, run.chatId, onEvent, true)
  }

  /** The live webhook this address names, or null for any address that is not one. */
  find(token: string): LiveWebhook | null {
    const hook = this.store.live(claimedId(token))
    return addressMatches(this.addressKey, token, hook) ? hook : null
  }
  verify(hook: LiveWebhook, body: Uint8Array, headers: Headers) {
    return !hook.signing || signatureValid(hook.signing, body, headers, this.now())
  }
  /** A verified delivery: dropped as a repeat, refused when too many wait, otherwise kept for a run. Both cheap checks
   *  come before the body is decoded and scanned. */
  receive(hook: LiveWebhook, body: Uint8Array, headers: Headers): Delivery {
    const keys = deliveryKeys(hook.signing, body, headers)
    if ((keys.deliveryId || keys.bodyHash) && this.store.events.seen(hook.id, keys)) return 'duplicate'
    if (this.store.events.waiting(hook.id).count >= WEBHOOK_LIMITS.waiting) return 'full'
    const token = addressPath(this.addressKey, hook).slice('/hook/'.length)
    if (!this.store.events.add(hook.id, keys, eventView(body, headers, keys.deliveryId, this.now(), token), this.now())) return 'duplicate'
    this.store.touch(hook.id, this.now())
    this.changed()
    return 'accepted'
  }

  canRun = (run: WebhookRun) => this.host.hasEngine?.(run.botId) ?? true
  async run(run: WebhookRun) {
    if (this.host.hasEngine?.(run.botId) === false) {
      const result = { status: 'failed' as const, text: 'This bot’s engine is not available.' }
      this.store.finish(run.id, result.status, result.text, this.now())
      this.changed()
      return result
    }
    const webhook = this.store.get(run.botId, run.webhookId)
    const { items, withheld } = this.store.events.forRun(run.id)
    if (!items.length) {
      const result = { status: 'failed' as const, text: `${withheld.length} event(s) withheld by LilBot's safety check: ${withheld[0] ?? 'no payload'}.` }
      this.store.finish(run.id, result.status, result.text, this.now())
      this.changed()
      return result
    }
    const access = webhookRunAccess(webhook.capabilities, this.t3Enabled)
    const result = await this.host.runRoutine(run.botId, webhookPrompt(webhook, access.prompt, items, withheld.length), {
      runId: `webhook-${run.id}`,
      toolsets: access.toolsets,
      origin: { line: webhookLine },
      onChat: id => {
        this.store.attach(run.id, id, this.now())
        this.changed()
      }
    })
    this.store.finish(run.id, result.status, result.text, this.now())
    this.changed()
    return result
  }
}
