import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import { connectionKey } from '../../server/connections/connection-keys'
import { engineToken } from '../../server/http/engine-api'
import { SYSTEM_KEY_PURPOSE } from '../../server/system/system-connection'
import { fakeService } from '../helpers/fake-engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

test('createAppServices wires narrowed threadStore, webhook callers, and workerAllowMemory end-to-end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-app-svc-'))
  const prevSkills = process.env.LILBOT_SKILLS_DIR
  process.env.LILBOT_SKILLS_DIR = join(dir, 'skills')
  mkdirSync(join(dir, 'skills'), { recursive: true })
  const intervals: ReturnType<typeof setInterval>[] = []
  const origSetInterval = globalThis.setInterval
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = origSetInterval(...args)
    intervals.push(id)
    return id
  }) as typeof setInterval
  try {
    const fake = fakeService()
    let onTool: ((call: { engineBotId: string; chatId: string; tool: string; args: unknown; callId?: string }) => void) | undefined
    fake.engine.onToolCall = cb => {
      onTool = cb
      return () => {}
    }
    const services = createAppServices(fake.engine, {
      DATA_DIR: join(dir, 'data'),
      WORKSPACES_DIR: join(dir, 'ws'),
      PORT: 3999,
      MEMORY_ADAPTER_VERSION: '0.14.0',
      COMMIT: 'test',
      HOOK_ORIGIN: undefined,
      ACCESS_HOST: undefined,
      publish: () => {},
      botsChanged: () => {}
    })
    cleanups.push(() => {
      for (const id of intervals) clearInterval(id)
      services.computers.close()
      services.remoteWorkers.runner.close()
      rmSync(dir, { recursive: true, force: true })
      rmSync(fake.root, { recursive: true, force: true })
      if (prevSkills === undefined) delete process.env.LILBOT_SKILLS_DIR
      else process.env.LILBOT_SKILLS_DIR = prevSkills
    })
    await services.bots.createBot({ name: 'Bot One', function: 'One', instructions: '' })
    await services.bots.createBot({ name: 'Bot Two', function: 'Two', instructions: '' })
    const [b1, b2] = services.store.list()
    const token = engineToken(join(dir, 'data'))
    const hook = services.webhooks.store.create(b1.id, { requestId: 'h1', description: 'H', source: 'GH', createdBy: 'oscar' }, null, 1)
    services.webhooks.store.setCapabilities(b1.id, hook.id, ['delegation'])
    services.threads.store.db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES ('run-1', ?, ?, 1, 'running')").run(hook.id, b1.id)
    services.webhooks.store.attach('run-1', 'wh-1', 2)

    // callers wired into createThreads -> threads.ask from wh-1 persists narrowed capabilities.
    const { threadId } = await services.threads.ask(b1.id, { requestId: 'a1', to: b2.id, text: 'check', chatId: 'wh-1' })
    expect(services.threads.store.get(threadId).capabilities).toEqual(['delegation'])
    services.threads.store.attach(services.threads.store.delivery(`${b1.id}:a1`)!, b2.id, 'b2-narrow', true)

    // narrowed threadStore wired into createWebhooks -> engineApi locks memory context & System MCP blocks computers/memory for b2-narrow.
    await services.bots.writeMemory({ botId: b2.id, kind: 'profile', text: 'Secret narrowed fact.' })
    const memRes = await services.engineApi(
      new Request('http://127.0.0.1:3999/engine/memory/context', {
        method: 'POST',
        headers: { host: '127.0.0.1:3999', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ botId: b2.id, chatId: 'b2-narrow' })
      }),
      '/engine/memory/context'
    )
    expect(memRes.status).toBe(200)
    expect(((await memRes.json()) as { text: string }).text).toBe('')
    onTool?.({ engineBotId: b2.engineBotId, chatId: 'b2-narrow', tool: 'mcp__lilbot_system__lilbot_computers_list', args: {}, callId: 'c1' })
    const compMcp = await services.system.handler(
      new Request('http://127.0.0.1:3999/engine/lilbot/mcp', {
        method: 'POST',
        headers: { host: '127.0.0.1:3999', authorization: `Bearer ${connectionKey(token, SYSTEM_KEY_PURPOSE, b2.id)}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lilbot_computers_list', arguments: {} } })
      })
    )
    expect(JSON.parse(((await compMcp.json()) as any).result.content[0].text).refused).toContain('cannot use lilbot_computers_list')

    // workerAllowMemory wired into createSystemServer -> workerMcp blocks memory for narrowed worker thread.
    const narrowMcp = JSON.parse(
      (
        await services.system.workerMcp(
          { botId: b2.id, computerId: 'c1', threadId, runId: 'r1', chatId: `remote:${threadId}` },
          JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lilbot_memory_list', arguments: {} } })
        )
      ).body
    )
    expect(narrowMcp.result.isError).toBe(true)
    expect(narrowMcp.result.content[0].text).toMatch(/cannot read memory/)

    const openThread = services.threads.store.accept(b1, b1, { requestId: 'open-w', text: 'w', chatId: 'b1-main', worker: true }).threadId
    const openMcp = JSON.parse(
      (
        await services.system.workerMcp(
          { botId: b1.id, computerId: 'c1', threadId: openThread, runId: 'r2', chatId: `remote:${openThread}` },
          JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lilbot_memory_list', arguments: {} } })
        )
      ).body
    )
    expect(openMcp.result.isError).toBeUndefined()
  } finally {
    globalThis.setInterval = origSetInterval
  }
})
