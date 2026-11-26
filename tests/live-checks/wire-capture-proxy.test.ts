import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GuardPolicy } from '../../live-checks/outside-access-guard'
import { REFUSED_TOOL, startWireCaptureProxy } from '../../live-checks/prompt-wire-proxy'
import { toolCallsInRequest, toolCallsInResponse } from '../../live-checks/tool-calls-on-wire'
import { stopOnAccountProblem } from '../../live-checks/wire-verdicts'

const base = mkdtempSync(join(tmpdir(), 'wire-proxy-test-'))
const workspaces = join(base, 'workspaces')
const folder = join(workspaces, 'bot')
mkdirSync(join(folder, 'fixtures'), { recursive: true })
writeFileSync(join(folder, 'fixtures', 'disk-status.txt'), 'Free: 412 GB\n')
afterAll(() => rmSync(base, { recursive: true, force: true }))

const policy: GuardPolicy = { roots: [], programs: ['cat', 'ls', 'find', 'head', 'wc', 'echo', 'pwd'], commands: ['sleep 8 && echo DONE'] }

describe('reading tool calls off the wire', () => {
  test('streamed and plain answers in each format, and request history', () => {
    const anthropic = [
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"read_file","input":{}}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\": \\"/et"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"c/hostname\\"}"}}'
    ].join('\n')
    expect(toolCallsInResponse(anthropic)).toEqual([{ name: 'read_file', args: { path: '/etc/hostname' } }])
    const openai = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"terminal","arguments":"{\\"command\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ls ~\\"}"}}]}}]}'
    ].join('\n')
    expect(toolCallsInResponse(openai)).toEqual([{ name: 'terminal', args: { command: 'ls ~' } }])
    expect(toolCallsInResponse('{"content":[{"type":"tool_use","name":"read_file","input":{"path":"a"}}]}')).toEqual([{ name: 'read_file', args: { path: 'a' } }])
    expect(toolCallsInResponse('data: {"type":"tool_use" garbled')).toEqual([{ name: '', args: {} }])
    const history = { messages: [{ role: 'assistant', content: [{ type: 'tool_use', name: 'terminal', input: { command: 'cat /etc/hostname' } }] }] }
    expect(toolCallsInRequest(history)).toEqual([{ name: 'terminal', args: { command: 'cat /etc/hostname' } }])
  })

  test('the capture proxy renames a refused call so the engine runs nothing, and a refused call that ran stops the check', async () => {
    const answerFor = (path: string) =>
      [
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"read_file","input":{}}}',
        `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(JSON.stringify({ path }))}}}`
      ].join('\n\n')
    let answer = answerFor('fixtures/../../../code/QRit/docs/INVOICE.md')
    let forwarded = 0
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        forwarded++
        return new Response(answer, { headers: { 'content-type': 'text/event-stream' } })
      }
    })
    const proxy = startWireCaptureProxy(`http://127.0.0.1:${upstream.port}`, { workspaces: [workspaces], policy })
    const send = (messages: unknown[] = []) =>
      fetch(`${proxy.url}/v1/messages`, { method: 'POST', body: JSON.stringify({ model: 'm', system: `Your folder is ${folder}.`, tools: [{ name: 'read_file' }], messages }) })
    const call = (name: string, path: string) => [{ role: 'assistant', content: [{ type: 'tool_use', name, input: { path } }] }]
    try {
      const refused = await send()
      const text = await refused.text()
      expect(refused.status).toBe(200)
      expect(text).toContain(`"name":"${REFUSED_TOOL}"`)
      expect(text).not.toContain('"name":"read_file"')
      expect(proxy.records[0]?.outside).toContain('INVOICE.md')
      expect(() => stopOnAccountProblem(proxy.records)).toThrow('guard refused a tool call')
      expect(() => stopOnAccountProblem(proxy.records, 0, undefined, 'go on')).not.toThrow()

      answer = answerFor('fixtures/disk-status.txt')
      expect((await send(call(REFUSED_TOOL, '/etc/hostname'))).status).toBe(200)
      expect(proxy.records[1]?.outside ?? proxy.records[1]?.breach).toBeUndefined()

      answer = 'data: {"type":"tool_use" garbled'
      expect((await send()).status).toBe(400)

      const before = forwarded
      expect((await send(call('read_file', '/etc/hostname'))).status).toBe(451)
      expect(forwarded).toBe(before)
      expect(proxy.records[3]?.breach).toContain('/etc/hostname')
      expect(() => stopOnAccountProblem(proxy.records, 0, undefined, 'go on')).toThrow('does not allow ran')
    } finally {
      proxy.stop()
      upstream.stop(true)
    }
  })
})
