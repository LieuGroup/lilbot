/** The real app wiring (#317): deleting a bot through `createAppServices` removes its shown files' rows, the paths
 *  LilBot would otherwise keep serving if the id were ever reused. */

import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import { fakeService } from '../helpers/fake-engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

test("deleting a bot leaves none of its shown_files rows, and another bot's stay", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-shown-delete-'))
  const prevSkills = process.env.LILBOT_SKILLS_DIR
  process.env.LILBOT_SKILLS_DIR = join(dir, 'skills')
  mkdirSync(join(dir, 'skills'), { recursive: true })
  const fake = fakeService()
  const origSetInterval = globalThis.setInterval
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = (() => 0) as unknown as typeof setInterval
  const services = createAppServices(fake.engine, {
    DATA_DIR: join(dir, 'data'),
    WORKSPACES_DIR: join(dir, 'ws'),
    PORT: 3995,
    MEMORY_ADAPTER_VERSION: '0.14.0',
    COMMIT: 'test',
    HOOK_ORIGIN: undefined,
    ACCESS_HOST: undefined,
    SHOW_ENABLED: true,
    publish: () => {},
    botsChanged: () => {}
  })
  globalThis.setInterval = origSetInterval
  const db = new Database(join(dir, 'data', 'lilbot.db'))
  cleanups.push(() => {
    db.close()
    services.computers.close()
    services.remoteWorkers.runner.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(fake.root, { recursive: true, force: true })
    if (prevSkills === undefined) delete process.env.LILBOT_SKILLS_DIR
    else process.env.LILBOT_SKILLS_DIR = prevSkills
  })
  const doomed = await services.bots.createBot({ name: 'Doomed', function: 'Test', instructions: 'Hi.' })
  const kept = await services.bots.createBot({ name: 'Kept', function: 'Test', instructions: 'Hi.' })
  const insert = db.query("INSERT INTO shown_files VALUES (?, ?, 'chat', 'a.png', 'a.png', 'image', 'image/png', 10, NULL, 1000)")
  insert.run('s1', doomed.id)
  insert.run('s2', kept.id)
  const rows = (botId: string) => (db.query('SELECT count(*) n FROM shown_files WHERE bot_id=?').get(botId) as { n: number }).n
  expect([rows(doomed.id), rows(kept.id)]).toEqual([1, 1])
  await services.bots.deleteBot({ botId: doomed.id, files: 'delete', privateMemories: 'forget' })
  expect([rows(doomed.id), rows(kept.id)]).toEqual([0, 1])
})
