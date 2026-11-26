import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { outsideReach, toolCallsInRequest, toolCallsInResponse } from '../../live-checks/outside-access-guard'
import { startWireCaptureProxy, stopOnAccountProblem } from '../../live-checks/prompt-wire-proxy'

const root = join(homedir(), 'lilbot-dev', 'runs', 'guard-test', 'workspaces')
const roots = [root]
const reach = (name: string, args: Record<string, unknown>) => outsideReach({ name, args }, roots)

describe('outside-access guard', () => {
  test('lets calls inside the workspace through', () => {
    expect(reach('read_file', { path: 'fixtures/disk.txt' })).toBeNull()
    expect(reach('read_file', { path: join(root, 'bot', 'notes.md') })).toBeNull()
    expect(reach('write_file', { path: './packing-list.md', content: 'see /etc and ~/code in prose' })).toBeNull()
    expect(reach('terminal', { command: 'cat fixtures/disk.txt 2>/dev/null | head -5' })).toBeNull()
    expect(reach('search_files', { pattern: 'AUD', path: '.' })).toBeNull()
    expect(reach('patch', { mode: 'patch', patch: '*** Begin Patch\n*** Update File: notes.md\n@@\n-a\n+b\n*** End Patch' })).toBeNull()
    expect(reach('lilbot_work', { action: 'open', title: 'Packing list' })).toBeNull()
  })

  test('refuses a deliberate read outside, by any route', () => {
    expect(reach('read_file', { path: '~/code/notes.md' })).toContain('~/code/notes.md')
    expect(reach('read_file', { path: '/etc/hostname' })).toContain('/etc/hostname')
    expect(reach('read_file', { path: '../other-bot/secret.txt' })).toContain('../other-bot')
    expect(reach('search_files', { pattern: 'invoice', path: homedir() })).toContain(homedir())
    expect(reach('terminal', { command: 'grep -r invoice ~/code' })).toContain('~/code')
    expect(reach('terminal', { command: 'df -h /' })).toContain('/')
    expect(reach('terminal', { command: 'cd && ls' })).toContain('cd')
    expect(reach('terminal', { command: 'ls $HOME' })).toContain('$HOME')
    expect(reach('terminal', { command: 'curl https://example.com' })).toContain('https://')
    expect(reach('terminal', { command: 'ls', workdir: '/tmp' })).toContain('/tmp')
    expect(reach('execute_code', { code: "print(open('/etc/hostname').read())" })).toContain('/etc/hostname')
    expect(reach('execute_code', { code: "import shutil; print(shutil.disk_usage('/'))" })).toContain('/')
    expect(reach('execute_code', { code: "print(open('fixtures/disk-status.txt').read())" })).toBeNull()
    expect(reach('patch', { mode: 'patch', patch: '*** Begin Patch\n*** Add File: /tmp/x\n+a\n*** End Patch' })).toContain('/tmp/x')
    expect(reach('lilbot_computer_list_folder', { path: '.' })).toContain('outside')
    expect(reach('manage_connections', { action: 'list' })).toContain('outside')
    expect(reach('tool_call', { calls: [{ name: 'lilbot_computer_exec', arguments: '{"command":"ls"}' }] })).toContain('lilbot_computer_exec')
    expect(reach('tool_call', { name: 'read_file', arguments: { path: '/etc/hostname' } })).toContain('/etc/hostname')
  })

  test('finds tool calls in streamed and plain answers and in request history', () => {
    const anthropic = [
      'event: content_block_start',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"read_file","input":{}}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\": \\"/et"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"c/hostname\\"}"}}'
    ].join('\n')
    expect(toolCallsInResponse(anthropic)).toEqual([{ name: 'read_file', args: { path: '/etc/hostname' } }])
    const openai = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"terminal","arguments":"{\\"command\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ls ~\\"}"}}]}}]}',
      'data: [DONE]'
    ].join('\n')
    expect(toolCallsInResponse(openai)).toEqual([{ name: 'terminal', args: { command: 'ls ~' } }])
    expect(toolCallsInResponse('{"content":[{"type":"tool_use","name":"read_file","input":{"path":"a"}}]}')).toEqual([{ name: 'read_file', args: { path: 'a' } }])
    const history = { messages: [{ role: 'assistant', content: [{ type: 'tool_use', name: 'terminal', input: { command: 'cat /etc/hostname' } }] }] }
    expect(toolCallsInRequest(history)).toEqual([{ name: 'terminal', args: { command: 'cat /etc/hostname' } }])
  })

  test('the capture proxy refuses an outside read before the engine sees it, and the check stops', async () => {
    const sse = [
      'data: {"type":"message_start","message":{"id":"m"}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"read_file","input":{}}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"~/code/QRit/docs/INVOICE.md\\"}"}}',
      'data: {"type":"message_stop"}'
    ].join('\n\n')
    const inside = sse.replace('~/code/QRit/docs/INVOICE.md', 'fixtures/disk.txt')
    let answer = sse
    const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(answer, { headers: { 'content-type': 'text/event-stream' } }) })
    const proxy = startWireCaptureProxy(`http://127.0.0.1:${upstream.port}`, roots)
    try {
      const send = () => fetch(`${proxy.url}/v1/messages`, { method: 'POST', body: JSON.stringify({ model: 'm', system: 's', tools: [{ name: 'read_file' }], messages: [] }) })
      const refused = await send()
      expect(refused.status).toBe(400)
      expect(await refused.text()).not.toContain('INVOICE')
      expect(proxy.records[0]?.outside).toContain('~/code/QRit/docs/INVOICE.md')
      expect(() => stopOnAccountProblem(proxy.records)).toThrow('reached outside the test workspace')
      answer = inside
      const passed = await send()
      expect(passed.status).toBe(200)
      expect(await passed.text()).toContain('fixtures/disk.txt')
      expect(proxy.records[1]?.outside).toBeUndefined()
    } finally {
      proxy.stop()
      upstream.stop(true)
    }
  })
})
