/** Bounded delivery queue: caps concurrent outbound sends, drops excess on overflow, and enforces per-send timeouts. */
import type { NotificationSendResult } from './notification-sender'

const DEFAULT_MAX_CONCURRENT_SENDS = 4
const DEFAULT_MAX_QUEUED_SENDS = 64
const DEFAULT_SENDER_TIMEOUT_MS = 15_000

export interface DeliveryQueueOptions {
  maxConcurrent?: number
  maxQueued?: number
  timeoutMs?: number
}

interface QueuedTask {
  run: () => Promise<NotificationSendResult>
  resolve: (result: NotificationSendResult) => void
}

function withTimeout(run: () => Promise<NotificationSendResult>, timeoutMs: number): Promise<NotificationSendResult> {
  if (timeoutMs <= 0) return run().catch(() => ({ status: 'failed', reason: 'sender_error' }))
  return new Promise(resolve => {
    let settled = false
    const finish = (result: NotificationSendResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => finish({ status: 'failed', reason: 'timeout' }), timeoutMs)
    timer.unref?.()
    try {
      Promise.resolve(run())
        .then(finish)
        .catch(() => finish({ status: 'failed', reason: 'sender_error' }))
    } catch {
      finish({ status: 'failed', reason: 'sender_error' })
    }
  })
}

export class DeliveryQueue {
  private active = 0
  private pending: QueuedTask[] = []
  private maxConcurrent: number
  private maxQueued: number
  private timeoutMs: number

  constructor(options: DeliveryQueueOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_SENDS)
    this.maxQueued = Math.max(0, options.maxQueued ?? DEFAULT_MAX_QUEUED_SENDS)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SENDER_TIMEOUT_MS
  }

  enqueue(run: () => Promise<NotificationSendResult>): Promise<NotificationSendResult> {
    if (this.active < this.maxConcurrent) return this.start(run)
    if (this.pending.length >= this.maxQueued) return Promise.resolve({ status: 'failed', reason: 'queue_full' })
    return new Promise(resolve => {
      this.pending.push({ run, resolve })
    })
  }

  private start(run: () => Promise<NotificationSendResult>): Promise<NotificationSendResult> {
    this.active++
    return withTimeout(run, this.timeoutMs).finally(() => {
      this.active--
      this.drain()
    })
  }

  private drain() {
    while (this.active < this.maxConcurrent && this.pending.length > 0) {
      const next = this.pending.shift()!
      void this.start(next.run).then(next.resolve)
    }
  }
}
