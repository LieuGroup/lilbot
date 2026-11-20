/** Real thread services over an in-memory database and a temporary workspaces folder, with an engine whose runs
 *  stay open until the test finishes them, so status, stop and redirect can be seen mid-run. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import type { RoutineOptions } from '../../server/engines/bot-engine'
import { DelegationControl } from '../../server/threads/delegation-control'
import { DelegationService } from '../../server/threads/delegation-service'
import { ThreadService } from '../../server/threads/thread-service'
import { ThreadStore } from '../../server/threads/thread-store'
import type { ChatItem } from '../../shared/chat-schema'

type Result = { status: string; text: string; items?: ChatItem[] }
interface Run {
  botId: string
  prompt: string
  options: RoutineOptions
  chatId: string
  finish(text?: string, before?: ChatItem[], status?: string): void
}

const roots: string[] = []
/** Each test file removes the folders its fixtures made: `afterAll(removeFixtureFolders)`. */
export function removeFixtureFolders() {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function delegationFixture() {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-delegation-'))
  roots.push(root)
  const workspaces = new Workspaces(root)
  const store = new ThreadStore(openDatabase(':memory:'))
  const bots = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase() }))
  const runs: Run[] = []
  const stops: string[] = []
  const steers: { chatId: string; text: string }[] = []
  const host = {
    requireBot: async (id: string) => {
      const bot = bots.find(b => b.id === id)
      if (!bot) throw new Error('missing')
      return bot
    },
    listBots: async () => bots,
    folder: (id: string) => workspaces.ensure(id),
    runRoutine: (botId: string, prompt: string, options: RoutineOptions) =>
      new Promise<Result>(resolve => {
        const chatId = options.chatId ?? `${botId}-hidden-${runs.length}`
        options.onChat(chatId)
        runs.push({
          botId,
          prompt,
          options,
          chatId,
          finish: (text = 'done', before = [], status = 'completed') => resolve({ status, text, items: [...before, { kind: 'assistant', text }] })
        })
      }),
    stopRun: async (_botId: string, chatId: string) => {
      stops.push(chatId)
      return true
    },
    steerRun: async (_botId: string, chatId: string, text: string) => {
      steers.push({ chatId, text })
      return 'steered' as const
    }
  }
  const threads = new ThreadService(store, host)
  const hand = new DelegationService(threads, host, async botId => `${botId}-main`)
  const control = new DelegationControl(threads, host)
  const delegation = {
    delegate: hand.delegate.bind(hand),
    attach: hand.attach.bind(hand),
    status: control.status.bind(control),
    cancel: control.cancel.bind(control),
    redirect: control.redirect.bind(control),
    wait: control.wait.bind(control)
  }
  const settle = async () => {
    threads.tick()
    await Bun.sleep(20)
  }
  return { root, store, threads, delegation, runs, stops, steers, settle, path: (bot: string, file: string) => join(root, bot, file) }
}
