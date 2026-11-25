/** Builds LilBot's memory service, after-chat review queue and reviewer, and durable pre-compress checkpoint store. */
import type { Database } from 'bun:sqlite'
import { LilBotError } from '../shared/lilbot-error'
import type { CheckpointChoice, MemoryCheckpointRefusal } from '../shared/memory-schema'
import type { EventFrame } from '../shared/protocol'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import type { EngineRegistry } from './engines/engine-registry'
import { createEngineApi, type EngineApiOptions } from './http/engine-api'
import { createPreCompressCheckpoint } from './http/history-api'
import type { StoppedTurn } from './memory/memory-checkpoint-meta'
import { type CheckpointChoiceAudit, MemoryCheckpointRefusalStore } from './memory/memory-checkpoint-refusals'
import { MemoryCheckpointStore } from './memory/memory-checkpoint-store'
import { MemoryReviewer, type PrepareReview, reviewSettingsFrom } from './memory/memory-reviewer'
import { MemoryService } from './memory/memory-service'
import { MemoryStore } from './memory/memory-store'
import { MemoryTurnContext, memoryRefreshTurnsFrom, withoutInjectedContext } from './memory/memory-turn-context'
import { ReviewQueue } from './memory/review-queue'
import { withoutWebhookNotes } from './webhooks/webhook-messages'

export interface CheckpointChoices {
  pending: (botId: string, chatId?: string) => MemoryCheckpointRefusal | null
  choose: (botId: string, chatId: string, pieceKey: string, choice: CheckpointChoice) => { ok: true; choice: CheckpointChoice }
  stoppedTurn: (botId: string, chatId: string) => StoppedTurn
  onNewSession: (botId: string) => void
  publishChat?: (chatId: string, data: Extract<EventFrame, { event: 'chat' }>['data']) => void
}

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

export function createMemory(
  database: Database,
  options: {
    deploymentNotice?: () => string | undefined
    refreshTurns?: number
    onMemoryChanged?: () => void
    onChoiceRecorded?: (audit: CheckpointChoiceAudit) => void
    publish?: (frame: EventFrame) => void
  } = {}
) {
  const onMemoryChanged = options.onMemoryChanged ?? (options.publish ? () => options.publish!({ event: 'memory.changed' }) : undefined)
  const publishChat = options.publish ? (chatId: string, data: Extract<EventFrame, { event: 'chat' }>['data']) => options.publish!({ event: 'chat', chatId, data }) : undefined
  const settings = reviewSettingsFrom(process.env)
  const memory = new MemoryService(new MemoryStore(database))
  const turnContext = new MemoryTurnContext(memory, {
    refreshTurns: options.refreshTurns ?? memoryRefreshTurnsFrom(process.env),
    deploymentNotice: options.deploymentNotice
  })
  const reviewQueue = new ReviewQueue(database)
  const checkpointStore = new MemoryCheckpointStore(database)
  let recordAudit: ((audit: CheckpointChoiceAudit) => void) | undefined = options.onChoiceRecorded
  const checkpointRefusals = new MemoryCheckpointRefusalStore(database, checkpointStore, onMemoryChanged, audit => recordAudit?.(audit))
  let reviewer: MemoryReviewer | undefined
  return {
    memory,
    turnContext,
    checkpointStore,
    checkpointRefusals,
    reviewModel: settings.model ?? null,
    isReview: (chat: string) => reviewer?.isReview(chat) ?? false,
    conversationHooks: (chatKind: (botId: string, chatId: string) => 'conversation' | 'lilbot' | 'unknown') => ({
      onTurnCompleted: (botId: string, chatId: string, userText: string, assistantText: string) => {
        if ((chatKind(botId, chatId) ?? 'conversation') === 'conversation' && !(reviewer?.isReview(chatId) ?? false))
          reviewer?.record(botId, chatId, withoutInjectedContext(withoutWebhookNotes(userText)).slice(0, 20_000), assistantText.slice(0, 20_000))
      },
      onCompacted: (botId: string, chatId: string) => turnContext.invalidateChat(botId, chatId)
    }),
    forgetBot: (botId: string) => {
      reviewQueue.forgetBot(botId)
      checkpointStore.forgetBot(botId)
      checkpointRefusals.forgetBot(botId)
      turnContext.forgetBot(botId)
    },
    wireEngineApi: (
      engines: EngineRegistry,
      token: string,
      port: number,
      opts: EngineApiOptions & {
        store: BotStore
        mainChat: (botId: string) => string | null
        rootOf: (botId: string, chatId: string) => string | null
        isLimited: (botId: string, chatId: string) => boolean
      }
    ) => {
      if (!recordAudit && opts.changes) {
        recordAudit = ({ at, botId, pieceKey, choice, chosenBy }) =>
          opts.changes!.record({
            at,
            botId,
            botName: opts.store.get(botId)?.name ?? botId,
            tool: 'memory_checkpoint_choice',
            target: pieceKey,
            fields: `by=${chosenBy}, choice=${choice}`
          })
      }
      const hasFallbackModel = (botId: string) => {
        if (!settings.model) return false
        const botModel = opts.store.get(botId)?.model
        return !botModel || botModel.provider !== settings.model.provider || botModel.model !== settings.model.model
      }
      const canChoose = (botId: string, chatId: string) => {
        if (opts.chatKind?.(botId, chatId) !== 'conversation' || opts.isLimited(botId, chatId) || (reviewer?.isReview(chatId) ?? false)) return false
        const main = opts.mainChat(botId)
        return main !== null && (chatId === main || opts.rootOf(botId, chatId) === main)
      }
      const botExists = (botId: string) => opts.botExists?.(botId) ?? true
      const checkpointChoices: CheckpointChoices = {
        pending: (botId, chatId) => {
          if (!botExists(botId)) return null
          const target = chatId ?? opts.mainChat(botId)
          return target && canChoose(botId, target) ? checkpointRefusals.pending(botId, target) : null
        },
        choose: (botId, chatId, pieceKey, choice) => {
          if (!botExists(botId)) throw new LilBotError('bot_not_found', 'That bot does not exist.')
          if (!canChoose(botId, chatId)) throw new LilBotError('checkpoint_choice_forbidden', 'This conversation cannot skip a memory save.')
          return checkpointRefusals.choose(botId, chatId, pieceKey, choice)
        },
        stoppedTurn: (botId, chatId) => checkpointRefusals.stoppedTurn(botId, chatId),
        onNewSession: botId => {
          if (checkpointRefusals.hasWaiting(botId)) onMemoryChanged?.()
        },
        publishChat
      }
      const full: EngineApiOptions = {
        ...opts,
        checkpointStore,
        checkpointRefusals: {
          hasFallbackModel,
          canAskOwner: canChoose,
          recordRefusal: (botId, chatId, pieceKey, pieceKeys, eligible, context) => checkpointRefusals.recordRefusal(botId, chatId, pieceKey, pieceKeys, eligible, context),
          clearPending: (botId, chatId, pieceKey) => checkpointRefusals.clearPending(botId, chatId, pieceKey)
        },
        onCheckpointSaved: (botId, chatId) => turnContext.invalidateChat(botId, chatId)
      }
      engines.setPreCompressCheckpoint(createPreCompressCheckpoint(full, memory))
      return { engineApi: createEngineApi(memory, token, port, full), checkpointChoices }
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
