/** Builds LilBot's memory service, after-chat review queue and reviewer, and durable pre-compress checkpoint store. */
import type { Database } from 'bun:sqlite'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import { MemoryCheckpointStore } from './memory/memory-checkpoint-store'
import { MemoryReviewer, reviewSettingsFrom } from './memory/memory-reviewer'
import { MemoryService } from './memory/memory-service'
import { MemoryStore } from './memory/memory-store'
import { ReviewQueue } from './memory/review-queue'

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
    startReviewer: (bots: BotService, store: BotStore, repeat: (name: string, interval: number, run: () => unknown | Promise<unknown>) => unknown) => {
      reviewer = new MemoryReviewer(reviewQueue, bots, settings, Date.now, id => store.exists(id))
      repeat('memory reviewer', 20_000, () => reviewer!.tick())
      return reviewer
    }
  }
}
