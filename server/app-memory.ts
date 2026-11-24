/** Builds LilBot's memory service, after-chat review queue and reviewer, and durable pre-compress checkpoint store. */
import type { Database } from 'bun:sqlite'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import { MemoryCheckpointStore } from './memory/memory-checkpoint-store'
import { MemoryReviewer, type PrepareReview, reviewSettingsFrom } from './memory/memory-reviewer'
import { MemoryService } from './memory/memory-service'
import { MemoryStore } from './memory/memory-store'
import { ReviewQueue } from './memory/review-queue'

const REFRESH_RETRY_MS: readonly number[] = [5_000, 15_000, 45_000, 120_000]

/** Runs startup memory preparation and retries with bounded backoff whenever a pass throws or reports failed bots. */
export function startMemoryPreparation(run: (onFailed: (id: string) => void) => Promise<void>, delays: readonly number[] = REFRESH_RETRY_MS): { stop: () => void } {
  let stopped = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (stopped) return
    const wait = delays[Math.min(attempt++, delays.length - 1)]
    timer = setTimeout(() => {
      timer = undefined
      void tick()
    }, wait)
    timer.unref?.()
  }
  const tick = async () => {
    if (stopped) return
    let failed = 0
    try {
      await run(() => {
        failed++
      })
    } catch (error) {
      failed++
      console.error('[memory] could not prepare memory for the bots:', error instanceof Error ? error.message : error)
    }
    if (failed > 0) schedule()
  }
  void tick()
  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }
}

export function createMemory(database: Database) {
  const settings = reviewSettingsFrom(process.env)
  const memory = new MemoryService(new MemoryStore(database))
  const reviewQueue = new ReviewQueue(database)
  const checkpointStore = new MemoryCheckpointStore(database)
  let reviewer: MemoryReviewer | undefined
  return {
    memory,
    checkpointStore,
    reviewModel: settings.model ?? null,
    isReview: (chat: string) => reviewer?.isReview(chat) ?? false,
    forgetBot: (botId: string) => {
      reviewQueue.forgetBot(botId)
      checkpointStore.forgetBot(botId)
    },
    startReviewer: (
      bots: BotService,
      store: BotStore,
      repeat: (name: string, interval: number, run: () => unknown | Promise<unknown>) => unknown,
      prepareReview?: PrepareReview
    ) => {
      reviewer = new MemoryReviewer(
        reviewQueue,
        bots,
        settings,
        Date.now,
        id => store.exists(id),
        prepareReview,
        id => memory.contextBlock(id).text
      )
      repeat('memory reviewer', 20_000, () => reviewer!.tick())
      return reviewer
    }
  }
}
