import { describe, expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { SessionGrants } from '../../server/system/session-grants'
import { ThreadFiles } from '../../server/threads/thread-files'
import { ThreadRunner } from '../../server/threads/thread-runner'
import { ThreadStore } from '../../server/threads/thread-store'
import { ThreadWaits } from '../../server/threads/thread-waits'
import { WorkService } from '../../server/work/work-service'
import { WorkStore } from '../../server/work/work-store'

const TOKEN = 'cutover-secret'
const BOTS = [
  { id: 'b1', name: 'Bot One' },
  { id: 'b2', name: 'Bot Two' },
  { id: 'b3', name: 'Bot Three' }
]

type SeenRun = { botId: string; chatId?: string; access?: unknown; hasMcp: boolean; hasReady: boolean }

function makeRunner(db: ReturnType<typeof openDatabase>, grants: SessionGrants, store: ThreadStore) {
  const runs: SeenRun[] = []
  let nextSid = 0
  const runner = new ThreadRunner(
    store,
    new ThreadFiles(db),
    new ThreadWaits(store),
    {
      requireBot: async id => BOTS.find(b => b.id === id)!,
      narrowedAccess: caps => ({ access: { kind: 'webhook', capabilities: caps }, prompt: 'limited' }),
      prepareNarrowedSession: (botId, threadId, caps) => {
        const g = grants.ensure({ ownerKey: `thread:${threadId}:${botId}`, botId, scope: { kind: 'narrowed', threadId, capabilities: caps } })
        return {
          sessionMcp: grants.connectionsFor(g, 'http://127.0.0.1:3370', ['lilbot_work'], false),
          assertSessionMcpReady: () => {},
          onChat: id => grants.bindChat(g.id, id),
          primaryChatId: g.primaryChatId ?? undefined
        }
      },
      prepareNarrowedReply: (botId, chatId) => {
        const g = grants.activeForChat(botId, chatId)
        if (!g || (g.scope.kind !== 'narrowed' && g.scope.kind !== 'webhook')) return null
        return {
          sessionMcp: grants.connectionsFor(g, 'http://127.0.0.1:3370', ['lilbot_work'], false),
          assertSessionMcpReady: () => {},
          onChat: id => grants.bindChat(g.id, id),
          primaryChatId: g.primaryChatId ?? undefined,
          scopeKind: g.scope.kind,
          capabilities: g.scope.capabilities
        }
      },
      runRoutine: async (botId, _prompt, opts) => {
        runs.push({ botId, chatId: opts.chatId, access: opts.access, hasMcp: !!opts.sessionMcp?.length, hasReady: typeof opts.assertSessionMcpReady === 'function' })
        const sid = opts.chatId ?? `acp-granted-${++nextSid}`
        opts.onChat(sid)
        return { status: 'completed', text: 'ok', items: [{ kind: 'assistant', text: 'ok' }] }
      }
    },
    () => {},
    () => {},
    () => {}
  )
  const waitDone = async (id: string) => {
    runner.tick()
    for (let i = 0; i < 40 && store.delivery(id)?.status !== 'done'; i++) await Bun.sleep(10)
  }
  return { runner, runs, waitDone }
}

describe('Pre-deploy narrowed session cutover and direct checkId verdict binding', () => {
  test('ThreadRunner refuses to resume an ungranted pre-deploy narrowed workSession and resumes a granted one', async () => {
    const db = openDatabase(':memory:')
    const grants = new SessionGrants(db, TOKEN, (_b, c) => c)
    const store = new ThreadStore(db, (_b, c) => c)
    const [b1, b2] = BOTS
    const first = store.accept(b1, b2, { requestId: 'r1', text: 'first turn', chatId: 'wh-1', capabilities: ['delegation'] })
    store.attach(first, b2.id, 'legacy-tool-session', true)
    store.setStatus(first.id, 'done')

    const { runs, waitDone } = makeRunner(db, grants, store)
    const second = store.accept(b1, b2, { requestId: 'r2', text: 'second turn', chatId: 'wh-1', threadId: first.threadId, capabilities: ['delegation'] })
    await waitDone(second.id)
    expect(runs.filter(c => c.botId === 'b2').map(c => c.chatId)).toEqual([undefined])
    expect(grants.hasActiveGrantForChat('acp-granted-1')).toBe(true)

    const third = store.accept(b1, b2, { requestId: 'r3', text: 'third turn', chatId: 'wh-1', threadId: first.threadId, capabilities: ['delegation'] })
    await waitDone(third.id)
    expect(runs.filter(c => c.botId === 'b2').map(c => c.chatId)).toEqual([undefined, 'acp-granted-1'])
    db.close()
  })

  test('narrowed parent resumes with scope and sessionMcp for child answer/notice, and refuses ungranted or revoked parents', async () => {
    const db = openDatabase(':memory:')
    const grants = new SessionGrants(db, TOKEN, (_b, c) => c)
    const store = new ThreadStore(db, (_b, c) => c)
    const [b1, b2, b3] = BOTS
    const parentWork = store.accept(b1, b2, { requestId: 'p1', text: 'parent task', chatId: 'wh-root', capabilities: ['delegation', 'shell'] })
    const parentGrant = grants.ensure({
      ownerKey: `thread:${parentWork.threadId}:b2`,
      botId: 'b2',
      scope: { kind: 'narrowed', threadId: parentWork.threadId, capabilities: ['delegation', 'shell'] }
    })
    grants.bindChat(parentGrant.id, 'parent-acp-1')
    store.attach(parentWork, 'b2', 'parent-acp-1', true)
    store.setStatus(parentWork.id, 'done')

    const { runner, runs, waitDone } = makeRunner(db, grants, store)
    const child = store.accept(b2, b3, { requestId: 'c1', text: 'child task', chatId: 'parent-acp-1', capabilities: ['delegation', 'shell'] })
    await waitDone(child.id)
    runner.tick()
    for (let i = 0; i < 40 && !runs.some(r => r.botId === 'b2'); i++) await Bun.sleep(10)
    expect(runs.find(r => r.botId === 'b2')).toEqual({
      botId: 'b2',
      chatId: 'parent-acp-1',
      access: { kind: 'narrowed', capabilities: ['delegation', 'shell'] },
      hasMcp: true,
      hasReady: true
    })

    // Notice into the active narrowed parent preserves scope and sessionMcp; ungranted or revoked parents settle cleanly without resuming.
    store.enqueue('n1', child.threadId, 'b3', 'b2', 'parent-acp-1', 'Heads up', 'notice')
    await waitDone('n1')
    expect(runs.filter(r => r.botId === 'b2')).toHaveLength(2)
    expect(runs.at(-1)).toMatchObject({ botId: 'b2', chatId: 'parent-acp-1', access: { kind: 'narrowed', capabilities: ['delegation', 'shell'] }, hasMcp: true })

    grants.revoke(parentGrant.id)
    store.enqueue('n2', child.threadId, 'b3', 'b2', 'parent-acp-1', 'Late notice', 'notice')
    await waitDone('n2')
    store.enqueue('n3', child.threadId, 'b3', 'b2', 'legacy-ungranted-parent', 'Legacy notice', 'notice')
    await waitDone('n3')
    expect([store.delivery('n2')?.status, store.delivery('n3')?.status]).toEqual(['done', 'done'])
    expect(runs.filter(r => r.botId === 'b2')).toHaveLength(2)
    db.close()
  })

  test('WorkChecks.verdict binds directly to knownCheckId without CallingChats and revokes grant on settle', async () => {
    const db = openDatabase(':memory:')
    const grants = new SessionGrants(db, TOKEN, (_b, c) => c)
    let callingChatUsed = 0
    const work = new WorkService(new WorkStore(db), {
      requireBot: async id => ({ id, name: id === 'b1' ? 'Owner' : 'Checker' }),
      checkers: async () => [{ id: 'b2', name: 'Checker' }],
      checkModel: async () => null,
      callingChat: async () => {
        callingChatUsed++
        throw new Error('should not fall back to CallingChats')
      },
      session: (_b, c) => ({ origin: { kind: 'conversation', id: c }, askedBy: null }),
      libraryTitle: () => null,
      checkGoal: () => {},
      waiting: () => {},
      line: () => {},
      tell: () => {},
      onCheckSettled: checkId => grants.revokeByOwner(`check:${checkId}`),
      changed: () => {}
    })
    const opened = await work.actFrom('b1', { requestId: 'open-1', title: 'Deploy', kind: 'deploy', done: 'Live' }, 'main-b1')
    await work.actFrom(
      'b1',
      { requestId: 'done-1', itemId: opened.id, status: 'done', result: 'Shipped', evidence: [{ proves: 'Health', command: 'curl', output: 'ok' }] },
      'main-b1'
    )
    const check = work.checks.open(opened.id)!
    const grant = grants.ensure({ ownerKey: `check:${check.id}`, botId: 'b2', scope: { kind: 'check', checkId: check.id } })
    grants.bindChat(grant.id, 'chk-chat-1')
    work.checks.attach(check.id, 'chk-chat-1')

    await expect(
      work.act(
        'b2',
        { requestId: 'v-bad', itemId: opened.id, verdict: 'verified', result: 'ok', evidence: [{ proves: 'p', command: 'c', output: 'o' }] },
        'chk-chat-1',
        'wrong-check'
      )
    ).rejects.toThrow(/check session/)
    expect(callingChatUsed).toBe(0)

    const settled = await work.act(
      'b2',
      { requestId: 'v-ok', itemId: opened.id, verdict: 'verified', result: 'Confirmed', evidence: [{ proves: 'Checked', command: 'curl', output: 'ok' }] },
      'chk-chat-1',
      check.id
    )
    expect(settled.status).toBe('done')
    expect(callingChatUsed).toBe(0)
    expect(grants.get(grant.id)?.revokedAt).not.toBeNull()
    db.close()
  })
})
