/** The real app wiring: with ownership on, the prompt file is written and deleting the bot removes it through `createAppServices`. */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import { fakeService } from '../helpers/fake-engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

test('the app deletes a bot prompt file when the bot is deleted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-prompt-app-'))
  const prevSkills = process.env.LILBOT_SKILLS_DIR
  process.env.LILBOT_SKILLS_DIR = join(dir, 'skills')
  mkdirSync(join(dir, 'skills'), { recursive: true })
  const fake = fakeService()
  fake.engine.configurePrompt = async () => ({ active: true })
  const origSetInterval = globalThis.setInterval
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = (() => 0) as unknown as typeof setInterval
  const services = createAppServices(fake.engine, {
    DATA_DIR: join(dir, 'data'),
    WORKSPACES_DIR: join(dir, 'ws'),
    PORT: 3994,
    MEMORY_ADAPTER_VERSION: '0.14.0',
    COMMIT: 'test',
    HOOK_ORIGIN: undefined,
    ACCESS_HOST: undefined,
    PROMPT_OWNERSHIP: true,
    publish: () => {},
    botsChanged: () => {}
  })
  globalThis.setInterval = origSetInterval
  cleanups.push(() => {
    services.computers.close()
    services.remoteWorkers.runner.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(fake.root, { recursive: true, force: true })
    if (prevSkills === undefined) delete process.env.LILBOT_SKILLS_DIR
    else process.env.LILBOT_SKILLS_DIR = prevSkills
  })
  const bot = await services.bots.createBot({ name: 'Doomed', function: 'Test', instructions: 'Hi.' })
  const file = join(dir, 'data', 'prompts', `${bot.id}.txt`)
  expect(existsSync(file)).toBe(true)
  await services.bots.deleteBot({ botId: bot.id, files: 'delete', privateMemories: 'forget' })
  expect(existsSync(file)).toBe(false)
})
