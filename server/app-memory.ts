/** Builds LilBot's memory service, after-chat review queue and reviewer, persisted review sessions, and durable pre-compress checkpoint store. */
import type { Database } from 'bun:sqlite'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import type { SessionRoot } from './bots/hidden-chats'
import { MemoryCheckpointStore } from './memory/memory-checkpoint-store'
import { MemoryReviewer, reviewSettingsFrom } from './memory/memory-reviewer'
import { MemoryService } from './memory/memory-service'
import { MemoryStore } from './memory/memory-store'
import { ReviewQueue } from './memory/review-queue'
import { ReviewSessionStore, reviewSessionRefusal } from './memory/review-session-store'

export function createMemory(database: Database) {
  const settings = reviewSettingsFrom(process.env)
  const memory = new MemoryService(new MemoryStore(database))
  const reviewQueue = new ReviewQueue(database)
  const reviewSessions = new ReviewSessionStore(database)
  const checkpointStore = new MemoryCheckpointStore(database)
  let reviewer: MemoryReviewer | undefined
  return {
    memory,
    checkpointStore,
    reviewModel: settings.model ?? null,
    isReview: (chat: string) => reviewSessions.has(chat),
    reviewRefusal: (rootOf: SessionRoot) => reviewSessionRefusal(reviewSessions, rootOf, botId => reviewer?.reviewing(botId) ?? false),
    forgetBot: (botId: string) => {
      reviewQueue.forgetBot(botId)
      reviewSessions.forgetBot(botId)
      checkpointStore.forgetBot(botId)
    },
    startReviewer: (bots: BotService, store: BotStore, repeat: (name: string, interval: number, run: () => unknown | Promise<unknown>) => unknown) => {
      reviewer = new MemoryReviewer(
        reviewQueue,
        bots,
        settings,
        Date.now,
        id => store.exists(id),
        reviewSessions,
        id => memory.contextBlock(id).text
      )
      repeat('memory reviewer', 20_000, () => reviewer!.tick())
      return reviewer
    }
  }
}
