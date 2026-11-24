import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'
import { RoutineStore } from '../../server/routines/routine-store'
import { WEBHOOK_LIMITS } from '../../server/webhooks/webhook-limits'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import type { ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { runFixture as webhookFixture } from '../webhooks/webhook-fixture'

const items: ChatItem[] = [{ kind: 'assistant', text: 'Finished output.' }]

async function expectErrorCode(promise: Promise<unknown>, code: string) {
  try {
    await promise
    throw new Error(`Expected LilBotError(${code}), but resolved`)
  } catch (error) {
    expect(error).toBeInstanceOf(LilBotError)
    expect((error as LilBotError).code).toBe(code)
  }
}

test('RoutineStore.finish and WebhookStore.finish commit run status, transcript, and event cleanup atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-tx-atomic-'))
  try {
    const db = openDatabase(join(dir, 'lilbot.db'))
    db.query("INSERT INTO bots (id, name, function, instructions, engine_id, engine_bot_id) VALUES ('b1', 'One', '', '', 'test', 'n1')").run()
    db.query("INSERT INTO routines (id, bot_id, request_id, description, schedule, created_by, next_run_at) VALUES ('r1', 'b1', 'req', 'Task', '{}', 'oscar', 1)").run()
    db.query("INSERT INTO routine_runs (id, routine_id, bot_id, due_at, status) VALUES ('rr1', 'r1', 'b1', 1, 'running')").run()
    db.exec("CREATE TRIGGER fail_routine_tx BEFORE INSERT ON routine_run_transcripts BEGIN SELECT RAISE(ABORT, 'inject_routine_fail'); END;")
    const rStore = new RoutineStore(db)
    expect(() => rStore.finish('rr1', 'completed', 'Done', 100, items)).toThrow('inject_routine_fail')
    expect(rStore.run('b1', 'rr1')).toMatchObject({ status: 'running', result: '', finishedAt: null })

    db.query(
      "INSERT INTO webhooks (id, bot_id, request_id, description, source, created_by, created_at, address_nonce) VALUES ('w1', 'b1', 'req', 'Hook', 'CI', 'oscar', 1, 'nonce')"
    ).run()
    db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES ('wr1', 'w1', 'b1', 1, 'running')").run()
    db.query("INSERT INTO webhook_events (id, webhook_id, received_at, run_id, item) VALUES ('e1', 'w1', 1, 'wr1', '{\"ok\":1}')").run()
    db.exec("CREATE TRIGGER fail_webhook_tx BEFORE INSERT ON webhook_run_transcripts BEGIN SELECT RAISE(ABORT, 'inject_webhook_fail'); END;")
    const wStore = new WebhookStore(db)
    expect(() => wStore.finish('wr1', 'completed', 'Done', 100, items)).toThrow('inject_webhook_fail')
    expect(wStore.run('b1', 'wr1')).toMatchObject({ status: 'running', result: '', finishedAt: null })
    expect(db.query("SELECT item FROM webhook_events WHERE id = 'e1'").get()).toEqual({ item: '{"ok":1}' })
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('migration 40 upgrades from schema 39 and enforces FK cascade on both routine and webhook transcripts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-tx-cascade-'))
  const path = join(dir, 'lilbot.db')
  try {
    let db = openDatabase(path)
    db.exec('DROP TABLE IF EXISTS review_sessions; DROP TABLE routine_run_transcripts; DROP TABLE webhook_run_transcripts; PRAGMA user_version = 39;')
    db.close()
    db = openDatabase(path)
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 41 })

    for (const b of ['b1', 'b2']) {
      db.query(`INSERT INTO bots (id, name, function, instructions, engine_id, engine_bot_id) VALUES (?, ?, '', '', 'test', ?)`).run(b, b, `n-${b}`)
      db.query(`INSERT INTO routines (id, bot_id, request_id, description, schedule, created_by, next_run_at) VALUES (?, ?, 'req', 'T', '{}', 'oscar', 1)`).run(`r-${b}`, b)
      db.query(`INSERT INTO routine_runs (id, routine_id, bot_id, due_at, status) VALUES (?, ?, ?, 1, 'completed')`).run(`rr-${b}`, `r-${b}`, b)
      db.query(`INSERT INTO webhooks (id, bot_id, request_id, description, source, created_by, created_at, address_nonce) VALUES (?, ?, 'req', 'H', 'CI', 'oscar', 1, 'n')`).run(
        `w-${b}`,
        b
      )
      db.query(`INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES (?, ?, ?, 1, 'completed')`).run(`wr-${b}`, `w-${b}`, b)
    }

    const rStore = new RoutineStore(db)
    const wStore = new WebhookStore(db)
    rStore.transcripts.save('rr-b1', items, 100)
    rStore.transcripts.save('rr-b2', items, 100)
    wStore.transcripts.save('wr-b1', items, 100)
    wStore.transcripts.save('wr-b2', items, 100)

    rStore.forgetBot('b1')
    wStore.forgetBot('b1')
    expect(db.query('SELECT run_id FROM routine_run_transcripts').all()).toEqual([{ run_id: 'rr-b2' }])
    expect(db.query('SELECT run_id FROM webhook_run_transcripts').all()).toEqual([{ run_id: 'wr-b2' }])

    // Direct run deletion also cascades cleanly via foreign keys, and bot tombstone blocks new saves before forgetBot runs.
    db.query("UPDATE bots SET deletion = '{}' WHERE id = 'b2'").run()
    db.query("INSERT INTO routine_runs (id, routine_id, bot_id, due_at, status) VALUES ('rr-b2-late', 'r-b2', 'b2', 2, 'running')").run()
    rStore.finish('rr-b2-late', 'completed', 'Late', 200, items)
    expect(rStore.transcripts.get('rr-b2-late')).toBeNull()

    db.query("DELETE FROM webhook_runs WHERE id = 'wr-b2'").run()
    expect(db.query('SELECT COUNT(*) AS n FROM webhook_run_transcripts').get()).toEqual({ n: 0 })
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WebhookService.openRun enforces requireBot, bot_id scoping on runs, and deleted-webhook rejection', async () => {
  const f = await webhookFixture()
  try {
    f.engine.runRoutine = async (_id, _prompt, options) => {
      options.onChat('wh-guard-chat')
      return { status: 'completed', text: 'Done.', items }
    }
    f.send('{"ok":true}')
    await f.tick(f.now() + WEBHOOK_LIMITS.quietMs)
    const [run] = (await f.webhooks.list('b1'))[0].runs

    // 1. Cross-bot scoping on WebhookStore.run and WebhookService.openRun
    const b2 = await f.service.createBot({ name: 'Two', function: 'Other', instructions: '' })
    expect(() => f.webhooks.store.run(b2.id, run.id)).toThrow(LilBotError)
    await expectErrorCode(
      f.webhooks.openRun(b2.id, run.id, () => {}),
      'run_not_found'
    )

    // 2. Deleted-webhook check in WebhookService.openRun (even if a transcript row existed)
    await f.webhooks.delete('b1', f.hook.id)
    await expectErrorCode(
      f.webhooks.openRun('b1', run.id, () => {}),
      'webhook_not_found'
    )

    // 3. requireBot check in WebhookService.openRun: soft-deleted bot with live webhook/run rows must fail with bot_not_found
    const hook2 = await f.webhooks.create('b1', { requestId: 'wh-2', description: 'Second', source: 'CI', createdBy: 'oscar' })
    f.database
      .query(
        "INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, events, started_at, finished_at, chat_id, status, result) VALUES ('wr-live', ?, 'b1', 10, 1, 11, 12, 'c-live', 'completed', 'ok')"
      )
      .run(hook2.id)
    f.webhooks.store.transcripts.save('wr-live', items, 20)
    f.database.query('UPDATE bots SET deletion = \'{"choices":{"files":"archive","privateMemories":"forget"},"complete":false}\' WHERE id = \'b1\'').run()
    await expectErrorCode(
      f.webhooks.openRun('b1', 'wr-live', () => {}),
      'bot_not_found'
    )
  } finally {
    f.clean()
  }
})
