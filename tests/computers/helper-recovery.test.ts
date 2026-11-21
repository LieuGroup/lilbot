import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { prepareJournal } from '../../helper/journal'
import { until } from '../helpers/until'
import { adversary } from './adversarial-fixture'

for (const mode of ['unknown', 'exhausted'] as const)
  test(`real helper acknowledges ${mode} result and completes next request`, async () => {
    const f = adversary()
    const row = f.store.enqueue('bot', 'remote', 'old', { kind: 'exec', command: 'true', timeoutMs: 1000 })
    if (mode === 'unknown') f.db.query('DELETE FROM computer_requests WHERE id=?').run(row.id)
    else f.db.query('UPDATE computer_requests SET final_frames=8 WHERE id=?').run(row.id)
    mkdirSync(join(f.root, 'helper'), { recursive: true })
    const journal = new Database(join(f.root, 'helper/requests.db'))
    prepareJournal(journal)
    journal.query('INSERT INTO requests(id,result,finished_at) VALUES(?,?,?)').run(row.id, JSON.stringify({ output: 'old' }), Date.now())
    const child = f.launch()
    try {
      await until(() => (journal.query('SELECT finished_at FROM requests WHERE id=?').get(row.id) as { finished_at: number | null })?.finished_at === null)
      if (mode === 'exhausted') expect(f.store.status(row.id)).toBe('failed')
      const next = await f.service.submit('bot', { computer: 'remote', requestId: 'next', operation: { kind: 'exec', command: 'echo recovered' } })
      expect(next.status).toBe('completed')
      expect(next.result?.output).toContain('recovered')
      expect(f.disconnections).toEqual([])
    } finally {
      child.kill()
      await child.exited
      journal.close()
      f.close()
    }
  }, 20_000)
