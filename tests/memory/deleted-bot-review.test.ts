import { expect, spyOn, test } from 'bun:test'
import { BotStore } from '../../server/bots/bot-store'
import { openDatabase } from '../../server/database/database'
import { defaultReviewSettings, MemoryReviewer } from '../../server/memory/memory-reviewer'
import { ReviewQueue } from '../../server/memory/review-queue'
import { LilBotError } from '../../shared/protocol'
import { fakeEngine } from '../helpers/fake-engine'

test('a missing bot loses all queued turns, logs once, and is not retried', async () => {
  const database = openDatabase(':memory:')
  const queue = new ReviewQueue(database)
  const { engine } = fakeEngine()
  let now = 1
  const reviewer = new MemoryReviewer(queue, engine, { enabled: true, turns: 1, minTurns: 1, quietMs: 0 }, () => now)
  const review = spyOn(engine, 'reviewMemory').mockImplementation(async () => {
    // Also discard turns arriving while the review was in flight.
    queue.add('gone', 'chat', 'late turn', 'reply', now)
    throw new LilBotError('bot_not_found', 'A message the reviewer must not depend on.')
  })
  const log = spyOn(console, 'info').mockImplementation(() => {})
  try {
    // More than one review batch: forgetBot must clear the whole queue.
    for (let i = 0; i < 45; i++) reviewer.record('gone', 'chat', `turn ${i}`, 'reply')
    reviewer.record('other', 'chat', 'keep this', 'reply')
    expect(await reviewer.review('gone')).toBe(0)
    expect(queue.take('gone', 100)).toEqual([])
    expect(queue.pending()).toEqual([{ botId: 'other', turns: 1, lastAt: now }])
    queue.forgetBot('other')
    now += 11 * 60_000
    expect(reviewer.tick()).toEqual([])
    expect(await reviewer.review('gone')).toBe(0)
    expect(review).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
  } finally {
    review.mockRestore()
    log.mockRestore()
    database.close()
  }
})

test('an error message alone never discards queued turns', async () => {
  const database = openDatabase(':memory:')
  const queue = new ReviewQueue(database)
  const { engine } = fakeEngine()
  const reviewer = new MemoryReviewer(queue, engine)
  const review = spyOn(engine, 'reviewMemory').mockRejectedValue(new Error('That bot does not exist.'))
  const log = spyOn(console, 'error').mockImplementation(() => {})
  try {
    reviewer.record('a', 'chat', 'keep this', 'reply')
    await expect(reviewer.review('a')).rejects.toThrow('That bot does not exist.')
    expect(queue.take('a', 10)).toHaveLength(1)
  } finally {
    review.mockRestore()
    log.mockRestore()
    database.close()
  }
})

test('ticks discard even single turns of unknown or deleted bots while preserving owned missing runtimes', () => {
  const database = openDatabase(':memory:')
  const queue = new ReviewQueue(database)
  const { engine } = fakeEngine()
  const store = new BotStore(database)
  const bot = { id: 'owned', name: 'Owned', function: '', instructions: '', model: null, isDefault: false, engineId: 'fake', engineBotId: 'missing-runtime' }
  store.save(bot)
  store.save({ ...bot, id: 'deleted', engineBotId: 'deleted-native' })
  store.markDeleted(store.get('deleted'), { files: 'archive', privateMemories: 'keep' })
  const reviewer = new MemoryReviewer(queue, engine, { ...defaultReviewSettings, enabled: false }, Date.now, id => store.exists(id))
  try {
    for (const id of ['unknown', 'deleted', 'owned']) queue.add(id, 'chat', 'single turn', 'reply', 1)
    expect(reviewer.tick()).toEqual([])
    expect(queue.pending().map(item => item.botId)).toEqual(['owned'])
  } finally {
    database.close()
  }
})
