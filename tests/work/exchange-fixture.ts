/** Joins the work board to real exchanges between bots, for the tests of answers and drops on handed-over items. */
import { WorkBoard } from '../../server/work/work-board'
import { delegationFixture } from '../threads/delegation-fixture'
import { workFixture } from './work-fixture'

export type Fixtures = { w: ReturnType<typeof workFixture>; d: ReturnType<typeof delegationFixture>; board: WorkBoard }
const joinedOn = (w: ReturnType<typeof workFixture>) => {
  const d: Fixtures['d'] = delegationFixture({ database: w.database, work: w.links, changed: () => w.links.settleExchanges(id => d.store.get(id).stoppedBy?.name ?? null) })
  return { w, d, board: new WorkBoard(w.work, w.answers, d.threads) }
}
export const joined = () => joinedOn(workFixture())
export const deliveries = (f: Fixtures, kind: string) =>
  f.w.database.query('SELECT id, sender, target, sourceChat, text, status FROM thread_deliveries WHERE kind = ? ORDER BY rowid').all(kind) as any[]

/** `a` hands `b` a task under its own item, and `b` opens the item LilBot made for it, from the exchange's session. */
export async function handedOver(f: Fixtures) {
  const parent = await f.w.open('a')
  const { exchanges } = await f.d.delegation.delegate('a', { requestId: 'r', tasks: [{ to: 'b', task: 'Write hello.txt' }] })
  const id = exchanges[0].exchangeId
  await f.d.settle()
  const run = f.d.runs.find(r => r.botId === 'b')!
  f.w.state.chats.set('b', run.chatId)
  await f.w.work.act('b', { requestId: 'b1', title: 'Hello file', kind: 'file', done: 'hello.txt says hi' })
  return { parent, id, run }
}
