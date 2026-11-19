import '../scripts/dev-env'
/** Synthetic dev copy: 50 pages, mixed text/tool rows, no production reads. */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from '../server/database/database'
import type { BotEngine } from '../server/engines/bot-engine'
import { HistoryService } from '../server/history/history-service'
import { HistoryStore } from '../server/history/history-store'
import { devScratch } from '../scripts/dev-env'

const path = join(devScratch('history-benchmark'), 'history.db')
const db = openDatabase(path)
try {
  const store = new HistoryStore(db)
  const rows = Array.from({ length: 5000 }, (_, n) => ({
    id: `row:${n}`,
    at: n + 1,
    order: n,
    item:
      n % 5 === 0
        ? { kind: 'tool' as const, toolId: `tool:${n}`, name: 'terminal', detail: 'fixture command', result: 'output '.repeat(150), running: false }
        : { kind: n % 2 ? ('assistant' as const) : ('user' as const), text: `Turn ${n}: ${'fixture conversation text '.repeat(40)}` }
  }))
  store.session('fixture', 'session', 0)
  let start = performance.now()
  for (let i = 0; i < rows.length; i += 100) store.write('fixture', 'session', rows.slice(i, i + 100), String(i + 100), i + 100 === rows.length)
  store.discovered('fixture')
  const importMs = performance.now() - start
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  start = performance.now()
  const full = JSON.stringify(rows)
  const fullMs = performance.now() - start
  start = performance.now()
  const latest = JSON.stringify(store.page('fixture'))
  const pageMs = performance.now() - start
  console.log(
    JSON.stringify({ items: rows.length, dbBytes: statSync(path).size, importMs, fullBytes: Buffer.byteLength(full), fullMs, latestBytes: Buffer.byteLength(latest), pageMs })
  )
  if (process.argv.includes('--paced')) {
    store.forget('fixture')
    const worker = new HistoryService(
      store,
      {
        conversations: async () => ({
          list: async () => [{ id: 'session', at: 0 }],
          close() {},
          read: async (_id: string, cursor?: string | null) => {
            const start = Number(cursor ?? 0)
            return { rows: rows.slice(start, start + 100), cursor: String(start + 100), reset: false, empty: start >= rows.length }
          }
        })
      } as unknown as BotEngine,
      async () => [{ id: 'fixture', engineBotId: 'fixture' }],
      () => true
    )
    const began = performance.now()
    do {
      await Bun.sleep(1000)
      await worker.tick()
    } while (!store.progress('fixture').complete)
    console.log(JSON.stringify({ pacedImportMs: performance.now() - began, ...store.progress('fixture') }))
    worker.close()
  }
} finally {
  db.close()
}
