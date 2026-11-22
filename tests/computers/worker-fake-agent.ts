/** Writes a fake Claude Code CLI executable for worker tests: supports --version, stream-json NDJSON
 *  input/output, steering, loopback MCP calls (including server/discover), child-process sleep, model refusal, and spawn counting. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT = `#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log('2.1.327 (Fake Claude Code)')
  process.exit(0)
}
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const model = flag('--model') ?? ''
const mcpPath = flag('--mcp-config')
const emit = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + '\\n')

const reader = Bun.stdin.stream().getReader()
const decoder = new TextDecoder()
let buf = ''
const nextLine = async (): Promise<string | null> => {
  while (true) {
    const nl = buf.indexOf('\\n')
    if (nl !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.trim()) return line
      continue
    }
    const { done, value } = await reader.read()
    if (done) return buf.trim() || null
    buf += decoder.decode(value, { stream: true })
  }
}

const firstRaw = await nextLine()
const prompt = firstRaw ? JSON.parse(firstRaw).message.content : ''
const cfg = JSON.parse(prompt) as {
  mode: string
  spawnLog?: string
  childPidFile?: string
  waitMs?: number
  burst?: number
}
if (cfg.spawnLog) appendFileSync(cfg.spawnLog, 'spawn\\n')
emit({ type: 'system', subtype: 'init', session_id: 'fake-session-1' })

if (cfg.mode === 'refuse-model') {
  emit({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'fake-session-1', result: \`Model \${model} is not enabled for this account.\` })
  process.exit(1)
}
if (cfg.mode === 'refuse-stderr') {
  process.stderr.write(\`Error: unsupported model \${model}\\n\`)
  process.exit(2)
}
if (cfg.mode === 'burst') {
  const n = cfg.burst ?? 20
  for (let i = 0; i < n; i++) {
    emit({ type: 'assistant', session_id: 'fake-session-1', message: { content: [{ type: 'tool_use', id: \`t\${i}\`, name: 'Bash', input: { command: \`echo \${i}\` } }] } })
    emit({ type: 'user', session_id: 'fake-session-1', message: { content: [{ type: 'tool_result', tool_use_id: \`t\${i}\`, content: \`out-\${i}\`, is_error: false }] } })
    await Bun.sleep(5)
  }
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: 'fake-session-1', result: \`burst-\${n}-done\`, usage: { input_tokens: 10, output_tokens: 5 } })
  process.exit(0)
}
if (cfg.mode === 'steer') {
  emit({ type: 'assistant', session_id: 'fake-session-1', message: { content: [{ type: 'text', text: 'working' }] } })
  const steerRaw = await nextLine()
  const steered = steerRaw ? JSON.parse(steerRaw).message.content : 'none'
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: 'fake-session-1', result: \`steered:\${steered}\` })
  process.exit(0)
}
if (cfg.mode === 'sleep') {
  const sleeper = Bun.spawn(['sleep', '60'], { stdout: 'ignore', stderr: 'ignore' })
  if (cfg.childPidFile) writeFileSync(cfg.childPidFile, String(sleeper.pid))
  emit({ type: 'assistant', session_id: 'fake-session-1', message: { content: [{ type: 'tool_use', id: 's1', name: 'Bash', input: { command: 'sleep 60' } }] } })
  await Bun.sleep(cfg.waitMs ?? 60_000)
  sleeper.kill()
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: 'fake-session-1', result: 'slept' })
  process.exit(0)
}
if (cfg.mode === 'mcp') {
  const mcp = JSON.parse(readFileSync(mcpPath!, 'utf8')).mcpServers.lilbot_system
  const post = (body: unknown, extraHeaders: Record<string, string> = {}) =>
    fetch(mcp.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...mcp.headers, ...extraHeaders }, body: JSON.stringify(body) })
  const disc = await post({ jsonrpc: '2.0', id: 1, method: 'server/discover' })
  const badAuth = await fetch(mcp.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) })
  const badOrigin = await post({ jsonrpc: '2.0', id: 3, method: 'ping' }, { Origin: 'https://evil.example' })
  const call = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'lilbot_work', arguments: { title: 'Hi' } } })
  const callJson = await call.json()
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'fake-session-1',
    result: JSON.stringify({ discStatus: disc.status, badAuth: badAuth.status, badOrigin: badOrigin.status, callStatus: call.status, callResult: callJson.result })
  })
  process.exit(0)
}
emit({ type: 'result', subtype: 'success', is_error: false, session_id: 'fake-session-1', result: 'ok' })
`

export function writeFakeClaude(dir: string): string {
  const path = join(dir, 'fake-claude')
  writeFileSync(path, SCRIPT, { mode: 0o700 })
  return path
}
