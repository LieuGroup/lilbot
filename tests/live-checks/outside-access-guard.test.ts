import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type GuardPolicy, refusal } from '../../live-checks/outside-access-guard'
import { startWireCaptureProxy, stopOnAccountProblem } from '../../live-checks/prompt-wire-proxy'
import { toolCallsInRequest, toolCallsInResponse } from '../../live-checks/tool-calls-on-wire'

const base = mkdtempSync(join(tmpdir(), 'guard-test-'))
const workspaces = join(base, 'workspaces')
const folder = join(workspaces, 'bot')
mkdirSync(join(folder, 'fixtures'), { recursive: true })
writeFileSync(join(folder, 'fixtures', 'disk-status.txt'), 'Free: 412 GB\n')
symlinkSync('/', join(folder, 'root'))
for (const name of ['workspaces-old', 'workspacesx', 'workspaces2']) mkdirSync(join(base, name))
afterAll(() => rmSync(base, { recursive: true, force: true }))

const policy: GuardPolicy = { roots: [], programs: ['cat', 'ls', 'head', 'wc', 'echo', 'pwd'], commands: ['sleep 8 && echo DONE'] }
const why = (name: string, args: Record<string, unknown>, p = policy) => refusal({ name, args }, folder, p)
const shell = (command: string) => why('terminal', { command })

describe('live check guard: what a scenario needs is allowed', () => {
  test.each([
    ['read_file', { path: 'fixtures/disk-status.txt' }],
    ['read_file', { path: join(folder, 'fixtures', 'disk-status.txt') }],
    ['read_file', { path: './fixtures/../fixtures/disk-status.txt' }],
    ['write_file', { path: 'packing-list.md', content: '# Packing list\n- tent and/or tarp\n- 2/3 of the food\nsee https://example.com' }],
    ['search_files', { pattern: 'AUD', path: '.' }],
    ['patch', { mode: 'patch', patch: '*** Begin Patch\n*** Update File: notes.md\n@@\n-a\n+b\n*** End Patch' }],
    ['terminal', { command: 'cat fixtures/disk-status.txt' }],
    ['terminal', { command: 'ls -la fixtures' }],
    ['terminal', { command: `cat ${join(folder, 'packing-list.md')}` }],
    ['terminal', { command: 'sleep 8 && echo DONE' }],
    ['terminal', { command: 'pwd && ls' }],
    ['terminal', { command: 'cat fixtures/disk-status.txt;' }],
    ['terminal', { command: 'ls fixtures 2>&1' }],
    ['terminal', { command: 'cat fixtures/disk-status.txt | head -5; wc -l fixtures/disk-status.txt 2>/dev/null' }],
    ['mcp__lilbot_system__lilbot_work', { title: 'Packing list', evidence: [{ proves: 'written', command: `cat ${folder}/packing-list.md` }] }],
    ['tool_call', { calls: [{ name: 'lilbot_memory_save', arguments: '{"text":"Give money figures in AUD."}' }] }],
    ['tool_search', { query: 'routine schedule' }],
    ['mcp__lilbot_system__lilbot_work', { evidence: [{ proves: 'given', url: `/api/library/${crypto.randomUUID()}/${crypto.randomUUID()}` }] }],
    ['skill_manage', { action: 'create', name: 'packing', content: '---\nname: packing\n---\nPack light.' }]
  ])('%s %j', (name, args) => expect(why(name, args)).toBeNull())
})

describe('live check guard: every way out LILA-47 tried is refused', () => {
  test.each([
    // Home-relative
    'cat ~/x',
    'cat ~oscar/x',
    'cat $HOME/x',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the shell's own ${HOME}, as a model would write it
    'cat ${HOME}/x',
    'cat $(getent passwd root)',
    // Parent-relative, leading or inside a path
    'cat ../x',
    'cat ../../x',
    'cat fixtures/../../../code/QRit/README.md',
    'ls ./../..',
    'ls $PWD/../..',
    // Look-alike folders
    `ls ${join(base, 'workspaces-old')}`,
    `ls ${join(base, 'workspacesx')}`,
    `ls ${join(base, 'workspaces2')}`,
    'cat ~/lilbot-dev/hermes/.env',
    // Change directory first
    'cd',
    'cd ..',
    'pushd ~',
    'D=..; cd $D/$D',
    'cd fixtures/../..',
    'cd -',
    'cd "$OLDPWD"',
    'cd "$(dirname "$(dirname "$PWD")")"',
    // Other routes
    'df -h',
    'cat $(echo Li4vLi4vZXRj | base64 -d)',
    'ln -s / up && cat up/etc/hostname',
    'cat root/etc/hostname'
  ])('terminal: %s', command => expect(shell(command)).not.toBeNull())

  test.each([
    ['terminal', { command: 'ls', workdir: '..' }],
    ['read_file', { path: '../x' }],
    ['read_file', { path: '/api/library/x/../../../etc/hostname' }],
    ['read_file', { path: 'fixtures/../../../code/x' }],
    ['read_file', { path: 'root/etc/hostname' }],
    ['read_file', { path: '~/code/notes.md' }],
    ['read_file', { Path: '/etc/hostname' }],
    ['search_files', { pattern: 'invoice', path: '/home' }],
    ['execute_code', { code: "open('fixtures/../../../code/x')" }],
    ['execute_code', { code: 'import os; os.path.dirname(os.path.dirname(os.getcwd()))' }],
    ['execute_code', { code: "import os; print(open(chr(47)+'etc'+chr(47)+'hostname').read())" }],
    ['execute_code', { code: "import os; print(os.path.expanduser('~'))" }]
  ])('%s %j', (name, args) => expect(why(name, args)).not.toBeNull())

  test('unknown argument names, nested values and image addresses are resolved too', () => {
    const vision = { ...policy, tools: ['vision_analyze', 'custom_tool'] }
    expect(why('vision_analyze', { image_url: '/etc/hostname' }, vision)).toContain('/etc/hostname')
    expect(why('vision_analyze', { image_url: 'file:///etc/hostname' }, vision)).toContain('/etc/hostname')
    expect(why('custom_tool', { file: '../x' }, vision)).toContain('../x')
    expect(why('custom_tool', { paths: ['fixtures/a', '/etc/passwd'] }, vision)).toContain('/etc/passwd')
    expect(why('custom_tool', { options: { target: { where: '~/code' } } }, vision)).toContain('~/code')
    expect(why('vision_analyze', { image_url: 'fixtures/disk-status.txt' }, vision)).toBeNull()
  })

  test('tools that reach outside by nature are refused unless a check names them', () => {
    for (const name of ['web_search', 'web_extract', 'browser_exec', 'manage_connections', 'vision_analyze', 'image_generate', 'execute_code', 'delegate_task'])
      expect(why(name, {})).toContain('not a tool this check allows')
    expect(why('mcp__lilbot_system__lilbot_computer_exec', { command: 'ls' })).toContain('not a tool')
    expect(why('tool_call', { calls: [{ name: 'lilbot_connection', arguments: {} }] })).toContain('not a tool')
    expect(why('tool_call', { name: 'read_file', arguments: { path: '/etc/hostname' } })).toContain('/etc/hostname')
    expect(why('tool_call', { calls: [{ arguments: { itemId: 'a', result: 'packed' } }, 'stray'] })).toBeNull()
    expect(why('tool_call', { calls: [{ arguments: { path: '/etc/hostname' } }] })).toContain('/etc/hostname')
    expect(
      why('tool_call', {
        calls: [
          { name: 'read_file', arguments: {} },
          { name: 'web_search', arguments: {} }
        ]
      })
    ).toContain('web_search')
    expect(shell('python3 -V')).toContain('not a program')
    expect(shell('curl example.com')).toContain('not a program')
    expect(shell('cat fixtures/disk-status.txt | sh')).toContain('not a program')
    expect(shell('ls && cat /etc/hostname')).toContain('/etc/hostname')
    expect(shell('ls; cd ..')).toContain('not a program')
    expect(shell('  ')).toContain('an empty command')
    expect(shell('ls || cat ../x')).not.toBeNull()
    expect(shell('cat fixtures/disk-status.txt > /tmp/x')).toContain('shell syntax')
    expect(shell('cat fixtures/disk-status.txt 2>/tmp/x')).toContain('shell syntax')
  })
})

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

  test('the capture proxy refuses a deliberate outside read before the engine sees it, and the check stops', async () => {
    const answerFor = (path: string) =>
      [
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"read_file","input":{}}}',
        `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(JSON.stringify({ path }))}}}`
      ].join('\n\n')
    let answer = answerFor('fixtures/../../../code/QRit/docs/INVOICE.md')
    const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(answer, { headers: { 'content-type': 'text/event-stream' } }) })
    const proxy = startWireCaptureProxy(`http://127.0.0.1:${upstream.port}`, { workspaces: [workspaces], policy })
    const body = JSON.stringify({ model: 'm', system: `Your folder is ${folder}.`, tools: [{ name: 'read_file' }], messages: [] })
    const send = () => fetch(`${proxy.url}/v1/messages`, { method: 'POST', body })
    try {
      const refused = await send()
      expect(refused.status).toBe(400)
      expect(await refused.text()).not.toContain('INVOICE')
      expect(proxy.records[0]?.outside).toContain('INVOICE.md')
      expect(() => stopOnAccountProblem(proxy.records)).toThrow('guard refused a tool call')
      answer = answerFor('fixtures/disk-status.txt')
      const passed = await send()
      expect(passed.status).toBe(200)
      expect(proxy.records[1]?.outside).toBeUndefined()
    } finally {
      proxy.stop()
      upstream.stop(true)
    }
  })
})
