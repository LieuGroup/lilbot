import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BotStore } from '../../server/bots/bot-store'
import { openDatabase } from '../../server/database/database'
import { RoutineStore } from '../../server/routines/routine-store'
import { detail } from '../helpers/fake-engine'

test('closing and reopening SQLite keeps claims, schedule, aliases and completed results', () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp', 'routine-store-'))
  const path = join(root, 'db')
  let db = openDatabase(path)
  try {
    new BotStore(db).import('test', [{ ...detail, engineId: 'test', engineBotId: 'b1' }])
    let store = new RoutineStore(db)
    const routine = store.create('b1', { requestId: 'one', description: 'Check', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'bot' }, 0, 5)
    const [run] = store.claimDue(600_000)
    store.attach(run.id, 'stored', 600_000)
    db.close()
    db = openDatabase(path)
    store = new RoutineStore(db)
    expect(store.pending().map(run => run.id)).toEqual([run.id])
    expect(store.claimDue(900_000)).toEqual([])
    expect(store.isRoutineChat('stored')).toBe(true)
    store.finish(run.id, 'completed', 'Result', 600_001)
    expect(store.get('b1', routine.id)).toMatchObject({ nextRunAt: 900_000, runs: [expect.objectContaining({ result: 'Result', status: 'completed' })] })
    expect(store.claimDue(900_000).length).toBe(1)
    expect(store.claimDue(900_000)).toEqual([])
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
