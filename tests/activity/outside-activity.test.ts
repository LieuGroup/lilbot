import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import type { ActivityEvent } from '../../shared/activity-schema'
import { fakeService } from '../helpers/fake-engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

test("a chat held in the engine's own app never shows as the bot's activity or turns it unread; its conversation does", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-outside-activity-'))
  const intervals: ReturnType<typeof setInterval>[] = []
  const origSetInterval = globalThis.setInterval
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = origSetInterval(...args)
    intervals.push(id)
    return id
  }) as typeof setInterval
  const fake = fakeService()
  let emit: ((event: ActivityEvent) => void) | undefined
  fake.engine.watchActivity = (_bots, listener) => {
    emit = listener
    return () => {}
  }
  const services = (() => {
    try {
      return createAppServices(fake.engine, {
        DATA_DIR: join(dir, 'data'),
        WORKSPACES_DIR: join(dir, 'ws'),
        PORT: 3996,
        MEMORY_ADAPTER_VERSION: '0.15.0',
        COMMIT: 'test',
        HOOK_ORIGIN: undefined,
        ACCESS_HOST: undefined,
        publish: () => {},
        botsChanged: () => {}
      })
    } finally {
      globalThis.setInterval = origSetInterval
    }
  })()
  cleanups.push(() => {
    for (const id of intervals) clearInterval(id)
    services.computers.close()
    services.remoteWorkers.runner.close()
    rmSync(dir, { recursive: true, force: true })
  })
  await services.bots.createBot({ name: 'Activity Bot', function: 'Testing', instructions: '' })
  const [bot] = services.store.list()
  const chat = await services.bots.openChat(bot.id, undefined, () => {})
  chat.close()
  services.watchActivity()

  emit!({ botId: bot.id, chatId: 'engine-app-chat', key: 'o1', status: 'failed' })
  expect(services.activity.state(bot.id)).toMatchObject({ status: 'idle', unread: false })

  emit!({ botId: bot.id, chatId: chat.snapshot.chatId, key: 'm1', status: 'failed' })
  expect(services.activity.state(bot.id)).toMatchObject({ status: 'failed', unread: true })
})
