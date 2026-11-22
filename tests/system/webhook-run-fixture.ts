/** `systemFixture` with one webhook of bot b1 and a run of it in `RUN_CHAT`, still running unless `settle` ends it. */
import { until } from '../helpers/until'
import { systemFixture } from './system-fixture'

export const RUN_CHAT = 'webhook-run-chat'

export async function withRun(options?: { t3Enabled?: boolean }) {
  const f = systemFixture(options)
  const hook = await f.webhooks.create('b1', { requestId: 'r', description: 'Triage issues', source: 'GitHub', createdBy: 'oscar' })
  f.database.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES ('run-1', ?, 'b1', 1, 'running')").run(hook.id)
  f.webhookStore.attach('run-1', RUN_CHAT, 2)
  /** The run is over: LilBot recorded it completed. */
  const settle = () => f.database.query("UPDATE webhook_runs SET status = 'completed' WHERE id = 'run-1'").run()
  /** The next calls of b1 come from this session (the engine reports their starts there). */
  const callFrom = (chat: string) => f.from.set('b1', chat)
  /** `messages.tick()`, then waits until every message it began to show has been shown. */
  const showing = (f.webhookRuns.messages as unknown as { showing: Set<string> }).showing
  const tickMessages = async () => {
    f.webhookRuns.messages.tick()
    await until(() => showing.size === 0)
  }
  return { ...f, hook, settle, callFrom, tickMessages }
}
