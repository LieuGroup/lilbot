import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { devScratch } from '../../scripts/dev-paths'
import { BotStore } from '../../server/bots/bot-store'
import { openDatabase } from '../../server/database/database'
import { RoutineStore } from '../../server/routines/routine-store'
import { detail } from '../helpers/fake-engine'

test('claimDue waits for another connection to release its write lock', async () => {
  const root = devScratch('sqlite-contention')
  const path = join(root, 'lilbot.db')
  const db = openDatabase(path)
  let child: ReturnType<typeof Bun.spawn> | undefined
  try {
    expect(db.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 })
    new BotStore(db).import('test', [{ ...detail, engineId: 'test', engineBotId: detail.id }])
    const store = new RoutineStore(db)
    store.create(detail.id, { requestId: 'lock-test', description: 'Test', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' }, 0, 5)
    // A separate process can release its lock while this thread waits inside synchronous SQLite.
    child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `
      import { Database } from 'bun:sqlite'
      const db = new Database(process.argv[1])
      db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE')
      console.log('locked')
      await Bun.sleep(300)
      db.exec('COMMIT')
      db.close()
    `,
        path
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const reader = (child.stdout as ReadableStream<Uint8Array>).getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('locked')
    reader.releaseLock()
    const start = Date.now()
    expect(store.claimDue(300_000)).toHaveLength(1)
    expect(Date.now() - start).toBeGreaterThanOrEqual(100)
    expect(await child.exited).toBe(0)
    expect(store.claimDue(300_000)).toEqual([])
  } finally {
    child?.kill()
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
