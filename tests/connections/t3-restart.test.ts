import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createT3Bridge } from '../../server/connections/t3-bridge'
import { bridgeKey } from '../../server/connections/t3-connection'
import { T3Grants } from '../../server/connections/t3-grant'

/** The upstream task outlives the bridge. Recreate all bridge state, including the grant reader,
 * after a lost launch reply, then retry admission and follow the same task to completion. */
test('a lost T3 launch response survives bridge restart without starting another task', async () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp', 't3-restart-'))
  const path = join(root, 'grant.json')
  const token = 'test-engine-token'
  let bridge: ReturnType<typeof createT3Bridge>
  const tasks = new Map<string, { threadId: string; status: string; answer?: string }>()
  const followed: string[] = []
  let loseReply = true
  const upstream = (async (_url: unknown, init: RequestInit) => {
    const rpc = JSON.parse(String(init.body))
    const args = rpc.params.arguments
    let result: unknown
    if (rpc.params.name === 't3_thread_launch') {
      if (!tasks.has(args.clientRequestId)) tasks.set(args.clientRequestId, { threadId: 'durable-thread', status: 'running' })
      result = tasks.get(args.clientRequestId)
      if (loseReply) {
        loseReply = false
        throw new Error('LilBot stopped after upstream admitted the task')
      }
    } else {
      followed.push(args.threadId)
      result = [...tasks.values()].find(task => task.threadId === args.threadId)
    }
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { structuredContent: result } })
  }) as typeof fetch
  const restart = () => {
    bridge = createT3Bridge({ upstream: 'http://t3.test/mcp', grants: new T3Grants(path), engineToken: token, port: 3998, botIds: () => ['bot'], fetch: upstream })
  }
  const call = async (name: string, args: object) => {
    const response = await bridge(
      new Request('http://127.0.0.1:3998/engine/t3/mcp', {
        method: 'POST',
        headers: { host: '127.0.0.1:3998', authorization: `Bearer ${bridgeKey(token, 'bot')}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
      })
    )
    return (await response.json()).result
  }
  try {
    new T3Grants(path).save({ accessToken: 'synthetic-test-grant', expiresAt: Date.now() + 60_000, issuedAt: Date.now(), scope: '', label: 'Test' })
    restart()
    expect((await call('t3_thread_launch', { clientRequestId: 'stable-task' })).isError).toBe(true)
    restart()
    const launched = (await call('t3_thread_launch', { clientRequestId: 'stable-task' })).structuredContent
    expect(tasks.size).toBe(1)
    expect([...tasks.keys()]).toEqual(['lilbot:bot:stable-task'])
    expect((await call('t3_thread_wait', { threadId: launched.threadId })).structuredContent.status).toBe('running')
    Object.assign(tasks.get('lilbot:bot:stable-task')!, { status: 'completed', answer: 'Implemented once' })
    restart()
    expect((await call('t3_thread_read', { threadId: launched.threadId })).structuredContent).toMatchObject({ status: 'completed', answer: 'Implemented once' })
    expect(followed).toEqual(['durable-thread', 'durable-thread'])
    expect(tasks.size).toBe(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
