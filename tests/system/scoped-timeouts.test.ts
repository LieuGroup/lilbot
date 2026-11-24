import { afterEach, describe, expect, test } from 'bun:test'
import { BotCreation } from '../../server/bots/bot-creation'
import { BotStore } from '../../server/bots/bot-store'
import { openDatabase } from '../../server/database/database'
import { createScopedMcp, SCOPED_T3_WAIT_CAP_MS } from '../../server/system/scoped-mcp'
import { SessionGrants, sessionGrantToken } from '../../server/system/session-grants'
import { SystemChanges } from '../../server/system/system-changes'
import { computerTools, SCOPED_COMPUTER_WAIT_MS } from '../../server/system/tool-computers'

const TOKEN = 'timeouts-secret-token'
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe('Session-bound 30 s tool bounds', () => {
  test('clamps t3_thread_wait and computer exec waits and runs bot creation greeting asynchronously', async () => {
    const db = openDatabase(':memory:')
    const grants = new SessionGrants(db, TOKEN, (_b, c) => c)
    let forwardedTimeout: number | undefined
    let scoped!: ReturnType<typeof createScopedMcp>
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        return scoped(req, new URL(req.url).pathname)
      }
    })
    cleanups.push(() => server.stop(true))
    scoped = createScopedMcp({
      port: server.port!,
      grants,
      bots: () => [{ id: 'b1', name: 'Bot One' }],
      tools: [],
      changes: new SystemChanges(db),
      beyondOwn: () => false,
      t3Enabled: true,
      t3Forward: async (_botId, req) => {
        const body = (await req.json()) as any
        forwardedTimeout = body.params?.arguments?.timeoutMs
        return Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '{"timedOut":true}' }] } })
      }
    })
    const g = grants.ensure({ ownerKey: 'webhook:t3-1', botId: 'b1', scope: { kind: 'webhook', runId: 't3-1', capabilities: ['coding'] } })
    grants.bindChat(g.id, 'chat-t3')
    const tok = sessionGrantToken(TOKEN, 'b1', g.id)
    const res = await fetch(`http://127.0.0.1:${server.port}/engine/lilbot/session/${g.id}/t3/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 't3_thread_wait', arguments: { threadId: 't1', timeoutMs: 600_000 } } })
    })
    expect(res.status).toBe(200)
    expect(forwardedTimeout).toBe(SCOPED_T3_WAIT_CAP_MS)

    let seenWait: number | undefined
    const compTool = computerTools({
      computers: {
        submit: async (_b: string, req: { requestId: string }, maxWait?: number) => {
          seenWait = maxWait
          return { status: 'running', requestId: req.requestId, result: null }
        }
      } as any
    } as any).find(t => t.name === 'lilbot_computer_exec')!
    const scopedComp = (await compTool.run('b1', { computer: 'leader', requestId: 'req-slow', command: 'echo hi' }, {}, { sessionBound: true })) as any
    expect(seenWait).toBe(SCOPED_COMPUTER_WAIT_MS)
    expect(scopedComp.note).toContain('lilbot_computer_request_read')
    expect(scopedComp.note).toContain('req-slow')
    const plainComp = (await compTool.run('b1', { computer: 'leader', requestId: 'req-plain', command: 'echo hi' }, {}, {})) as any
    expect(seenWait).toBeUndefined()
    expect(plainComp.note).toBeUndefined()

    const store = new BotStore(db)
    let releaseCreate!: () => void
    let releaseGreeting!: () => void
    let createCalls = 0
    let greetingCalls = 0
    const createBlocker = new Promise<void>(r => (releaseCreate = r))
    const greetingBlocker = new Promise<void>(r => (releaseGreeting = r))
    const creation = new BotCreation(
      {
        createBot: async (_input: any, id: string) => {
          createCalls++
          await createBlocker
          db.query("INSERT INTO bots VALUES (?, 'New', '', '', NULL, 0, 'scripted', 'n2', NULL, 'full-access', NULL)").run(id)
        },
        openChat: async () => ({
          send: () => {
            greetingCalls++
            return greetingBlocker
          },
          close: () => {}
        })
      } as any,
      store
    )
    const caller = {
      id: 'b1',
      name: 'Bot One',
      function: '',
      instructions: '',
      model: null,
      isDefault: true,
      engineId: 'scripted',
      engineBotId: 'n1',
      reasoningEffort: null,
      permissionMode: 'full-access' as const
    }
    const p1 = creation.create(caller, { name: 'Fast', function: 'Help', instructions: 'Be fast.', requestId: 'fast-1' }, { waitForGreeting: false })
    const p2 = creation.create(caller, { name: 'Fast', function: 'Help', instructions: 'Be fast.', requestId: 'fast-1' }, { waitForGreeting: false })
    releaseCreate()
    const [created, created2] = await Promise.all([p1, p2])
    expect(created).toEqual(created2)
    expect(created.greetingPending).toBe(true)
    expect(createCalls).toBe(1)
    releaseGreeting()
    await Bun.sleep(20)
    expect(greetingCalls).toBe(1)
    expect(store.creationDone(created.id)).toBe(true)
    db.close()
  })
})
