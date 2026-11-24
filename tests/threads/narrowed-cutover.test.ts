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

describe('Pre-deploy narrowed session cutover and direct checkId verdict binding', () => {
  test('ThreadRunner refuses to resume an ungranted pre-deploy narrowed workSession and resumes a granted one', async () => {
    const db = openDatabase(':memory:')
    const grants = new SessionGrants(db, TOKEN, (_b, c) => c)
    const store = new ThreadStore(db, (_b, c) => c)
    const b1 = { id: 'b1', name: 'Bot One' }
    const b2 = { id: 'b2', name: 'Bot Two' }
    const first = store.accept(b1, b2, { requestId: 'r1', text: 'first turn', chatId: 'wh-1', capabilities: ['delegation'] })
    // Simulate a pre-deploy ungranted workSession recorded in thread_chats without a session_grants row.
    store.attach(first, b2.id, 'legacy-tool-session', true)
    store.setStatus(first.id, 'done')

    const second = store.accept(b1, b2, { requestId: 'r2', text: 'second turn', chatId: 'wh-1', threadId: first.threadId, capabilities: ['delegation'] })
    const seenChats: { botId: string; chatId: string | undefined }[] = []
    let nextSid = 0
    const runner = new ThreadRunner(
      store,
      new ThreadFiles(db),
      new ThreadWaits(store),
      {
        requireBot: async id => (id === 'b1' ? b1 : b2),
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
        runRoutine: async (botId, _prompt, opts) => {
          seenChats.push({ botId, chatId: opts.chatId })
          const sid = opts.chatId ?? `acp-granted-${++nextSid}`
          opts.onChat(sid)
          return { status: 'completed', text: 'ok', items: [{ kind: 'assistant', text: 'ok' }] }
        }
      },
      () => {},
      () => {},
      () => {}
    )
    runner.tick()
    for (let i = 0; i < 30 && store.delivery(second.id)?.status !== 'done'; i++) await Bun.sleep(10)
    // Turn 2 did NOT resume legacy-tool-session; started a fresh granted session instead!
    expect(seenChats.filter(c => c.botId === 'b2').map(c => c.chatId)).toEqual([undefined])
    expect(grants.hasActiveGrantForChat('acp-granted-1')).toBe(true)

    // Turn 3 DOES resume acp-granted-1 because its grant is active!
    const third = store.accept(b1, b2, { requestId: 'r3', text: 'third turn', chatId: 'wh-1', threadId: first.threadId, capabilities: ['delegation'] })
    runner.tick()
    for (let i = 0; i < 30 && store.delivery(third.id)?.status !== 'done'; i++) await Bun.sleep(10)
    expect(seenChats.filter(c => c.botId === 'b2').map(c => c.chatId)).toEqual([undefined, 'acp-granted-1'])
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

    // Wrong checkId refused without touching CallingChats.
    await expect(
      work.act(
        'b2',
        { requestId: 'v-bad', itemId: opened.id, verdict: 'verified', result: 'ok', evidence: [{ proves: 'p', command: 'c', output: 'o' }] },
        'chk-chat-1',
        'wrong-check'
      )
    ).rejects.toThrow(/check session/)
    expect(callingChatUsed).toBe(0)

    // Matching checkId settles the item and immediately revokes the check grant.
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
