import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { loadServerKey } from '../../server/computers/server-key'
import { addBot, systemFixture } from './system-fixture'
import { RUN_CHAT, withRun } from './webhook-run-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
})

function computerFixture() {
  let service!: ComputerService
  let store!: ComputerStore
  const f = systemFixture({
    makeComputers: (fake, workspaces) => {
      store = new ComputerStore(fake.database)
      service = new ComputerService(
        store,
        loadServerKey(fake.root),
        id => fake.store.exists(id),
        id => workspaces.pathFor(id),
        () => {},
        id => (fake.store.exists(id) ? fake.store.get(id).permissionMode : undefined)
      )
      store.add('remote', { name: 'Remote', os: 'linux', home: fake.root, capabilities: ['exec', 'read', 'write', 'list', 'copy'] }, 'key')
      return service
    }
  })
  cleanups.push(() => service.close())
  return { ...f, computers: service, computerStore: store }
}

test('all 8 MCP computer tools run through ComputerService with caller isolation and field-only audit logs', async () => {
  const f = computerFixture()
  const other = await addBot(f, 'Other')
  const listed = (await f.call('b1', 'lilbot_computers_list')).data
  expect(listed.map((c: any) => c.id)).toContain('leader')
  expect(listed.map((c: any) => c.id)).toContain('remote')
  expect(f.changes.recent(10)).toEqual([])

  const exec = (await f.call('b1', 'lilbot_computer_exec', { computer: 'leader', requestId: 'exec-1', command: 'printf MCP_SECRET_VALUE' })).data
  expect(exec.status).toBe('completed')
  expect(exec.result.output).toBe('MCP_SECRET_VALUE')
  expect(f.changes.recent(1)[0]).toMatchObject({ botId: 'b1', tool: 'lilbot_computer_exec', target: exec.id })
  expect(JSON.stringify(f.changes.recent(5))).not.toContain('MCP_SECRET_VALUE')

  const target = join(f.root, 'mcp-file.txt')
  const write = (await f.call('b1', 'lilbot_computer_write_file', { computer: 'leader', requestId: 'w1', path: target, data: 'HELLO_MCP' })).data
  expect(write.status).toBe('completed')
  const read = (await f.call('b1', 'lilbot_computer_read_file', { computer: 'leader', requestId: 'r1', path: target })).data
  expect(Buffer.from(read.result.output, 'base64').toString('utf8')).toBe('HELLO_MCP')
  const folder = (await f.call('b1', 'lilbot_computer_list_folder', { computer: 'leader', requestId: 'l1', path: f.root })).data
  expect(folder.result.output).toContain('mcp-file.txt')

  const readBack = (await f.call('b1', 'lilbot_computer_request_read', { computer: 'leader', requestId: 'exec-1' })).data
  expect(readBack.id).toBe(exec.id)
  expect((await f.call('b1', 'lilbot_computer_request_read', { computer: 'leader', requestId: 'missing' })).error).toContain('Unknown request')
  // Caller identity comes from the bot's key, never arguments: another bot cannot read b1's request.
  expect((await f.call(other.id, 'lilbot_computer_request_read', { computer: 'leader', requestId: 'exec-1', botId: 'b1', callerId: 'b1' })).error).toContain('Unknown request')

  const ws = await f.workspaces.ensure('b1')
  const copyToRes = await f.call('b1', 'lilbot_computer_copy', { computer: 'leader', requestId: 'cp1', direction: 'toWorkspace', path: target, workspacePath: 'copied.txt' })
  expect(copyToRes.error).toBeUndefined()
  expect(copyToRes.data.status).toBe('completed')
  expect(readFileSync(join(ws, 'copied.txt'), 'utf8')).toBe('HELLO_MCP')
  const fromPath = join(f.root, 'from-ws.txt')
  writeFileSync(join(ws, 'out.txt'), 'FROM_WS')
  const copyFrom = (await f.call('b1', 'lilbot_computer_copy', { computer: 'leader', requestId: 'cp2', direction: 'fromWorkspace', path: fromPath, workspacePath: 'out.txt' })).data
  expect(copyFrom.status).toBe('completed')
  expect(readFileSync(fromPath, 'utf8')).toBe('FROM_WS')
  const badCopy = await f.call('b1', 'lilbot_computer_copy', {
    computer: 'leader',
    requestId: 'cp3',
    direction: 'toWorkspace',
    path: target,
    workspacePath: 'missing-dir/file.txt'
  })
  expect(badCopy.error).toContain('Cannot access workspace file')
  expect(badCopy.error).not.toContain('/proc/self/fd')

  // Offline sync fails with actionable message; offline background queues idempotently and cancels cleanly.
  expect((await f.call('b1', 'lilbot_computer_exec', { computer: 'remote', requestId: 'off-sync', command: 'echo hi' })).error).toContain('offline')
  const bg = (await f.call('b1', 'lilbot_computer_exec', { computer: 'remote', requestId: 'off-bg', background: true, command: 'echo hi' })).data
  expect(bg.status).toBe('pending')
  const retry = (await f.call('b1', 'lilbot_computer_exec', { computer: 'remote', requestId: 'off-bg', background: true, command: 'echo hi' })).data
  expect(retry.id).toBe(bg.id)
  expect((await f.call('b1', 'lilbot_computer_exec', { computer: 'remote', requestId: 'off-bg', background: true, command: 'echo other' })).error).toContain('different arguments')
  const cancelled = (await f.call('b1', 'lilbot_computer_cancel', { computer: 'remote', requestId: 'off-bg' })).data
  expect(cancelled.status).toBe('cancel_acked')
  expect(existsSync(join(f.root, 'mcp-file.txt'))).toBe(true)
})

test('narrow webhook runs are refused all 8 MCP computer tools until computers capability is added', async () => {
  const f = await withRun()
  f.callFrom(RUN_CHAT)
  const calls: [string, Record<string, unknown>][] = [
    ['lilbot_computers_list', {}],
    ['lilbot_computer_exec', { computer: 'leader', command: 'echo hi' }],
    ['lilbot_computer_read_file', { computer: 'leader', path: '/tmp/a' }],
    ['lilbot_computer_write_file', { computer: 'leader', path: '/tmp/a', data: 'x' }],
    ['lilbot_computer_list_folder', { computer: 'leader', path: '/tmp' }],
    ['lilbot_computer_request_read', { computer: 'leader', requestId: 'r1' }],
    ['lilbot_computer_cancel', { computer: 'leader', requestId: 'r1' }],
    ['lilbot_computer_copy', { computer: 'leader', requestId: 'r1', direction: 'toWorkspace', path: '/tmp/a', workspacePath: 'a' }]
  ]
  for (const [name, args] of calls) {
    const res = await f.call('b1', name, args)
    expect(res.error, name).toContain(`A webhook run cannot use ${name}`)
    expect(res.error, name).toContain('"computers"')
  }
  await f.webhooks.setCapabilities('b1', f.hook.id, ['computers'])
  expect((await f.call('b1', 'lilbot_computers_list')).error).toBeUndefined()
})

test('check sessions are refused all 8 MCP computer tools including reads while main session keeps working', async () => {
  const f = computerFixture()
  const check = f.work.work.checks.add('item-1', { kind: 'bot', id: 'b1', name: 'B1' }, null, null, Date.now())
  f.work.work.checks.attach(check.id, 'b1-check')
  f.from.set('b1', 'b1-check')
  const calls: [string, Record<string, unknown>][] = [
    ['lilbot_computers_list', {}],
    ['lilbot_computer_exec', { computer: 'leader', requestId: 'c1', command: 'echo hi' }],
    ['lilbot_computer_read_file', { computer: 'leader', requestId: 'c2', path: '/tmp/a' }],
    ['lilbot_computer_write_file', { computer: 'leader', requestId: 'c3', path: '/tmp/a', data: 'x' }],
    ['lilbot_computer_list_folder', { computer: 'leader', requestId: 'c4', path: '/tmp' }],
    ['lilbot_computer_request_read', { computer: 'leader', requestId: 'c1' }],
    ['lilbot_computer_cancel', { computer: 'leader', requestId: 'c1' }],
    ['lilbot_computer_copy', { computer: 'leader', requestId: 'c5', direction: 'toWorkspace', path: '/tmp/a', workspacePath: 'a' }]
  ]
  for (const [name, args] of calls) {
    expect((await f.call('b1', name, args)).error, name).toContain('This session is a check')
  }
  // Main session of the same bot keeps reaching computers while the check runs.
  f.from.set('b1', 'b1-main')
  expect((await f.call('b1', 'lilbot_computers_list')).data).toBeArray()
  expect((await f.call('b1', 'lilbot_computer_exec', { computer: 'leader', requestId: 'main-ok', command: 'printf OK' })).data.result.output).toBe('OK')
})

test('lilbot_computer_exec enforces LilBot safety stop with the same message as ComputerService.submit and runs ordinary commands without delay', async () => {
  const f = computerFixture()
  const destructive = 'if false; then mkfs; fi'
  const mcpRes = await f.call('b1', 'lilbot_computer_exec', { computer: 'remote', requestId: 'mcp-stop', background: true, command: destructive })
  let directError = ''
  try {
    await f.computers.submit('b1', { computer: 'remote', requestId: 'direct-stop', background: true, operation: { kind: 'exec', command: destructive } })
  } catch (error) {
    directError = error instanceof Error ? error.message : String(error)
  }
  expect(mcpRes.error).toContain('LilBot safety stop')
  expect(mcpRes.error).toBe(directError)
  expect((await f.call('b1', 'lilbot_computer_request_read', { computer: 'remote', requestId: 'mcp-stop' })).error).toContain('Unknown request')

  const started = performance.now()
  const ok = await f.call('b1', 'lilbot_computer_exec', { computer: 'leader', requestId: 'ordinary-ok', command: 'printf ORDINARY_OK' })
  const elapsedMs = performance.now() - started
  expect(ok.error).toBeUndefined()
  expect(ok.data.status).toBe('completed')
  expect(ok.data.result.output).toBe('ORDINARY_OK')
  expect(elapsedMs).toBeLessThan(2000)
})
