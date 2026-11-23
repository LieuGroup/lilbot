/** Shared fake Claude CLI and DB/service helper for remote worker delegation tests and live checks. */
import { generateKeyPairSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BotStore } from '../../server/bots/bot-store'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { loadServerKey } from '../../server/computers/server-key'
import { openDatabase } from '../../server/database/database'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { SkillsService } from '../../server/skills/skills-service'
import type { BotModel } from '../../shared/bot-schema'

const SCRIPT = `#!/usr/bin/env bun
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log('2.1.327 (Fake Claude Code)')
  process.exit(0)
}
if (args[0] === 'auth') {
  console.log('{"loggedIn":true}')
  process.exit(0)
}
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const model = flag('--model') ?? ''
const effort = flag('--effort') ?? ''
const resume = flag('--resume') ?? ''
const sysPrompt = flag('--append-system-prompt') ?? flag('--system-prompt') ?? ''
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
const prompt: string = firstRaw ? JSON.parse(firstRaw).message.content : ''
const sessionId = resume || 'claude-sess-' + crypto.randomUUID().slice(0, 8)
emit({ type: 'system', subtype: 'init', session_id: sessionId })

if (prompt.includes('MODE:SLEEP')) {
  emit({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sleep 60' } }] } })
  await Bun.sleep(60_000)
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: 'SLEEP_DONE' })
  process.exit(0)
}

if (prompt.includes('MODE:STEER')) {
  emit({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'README.md' } }] } })
  const steerRaw = await nextLine()
  const steered: string = steerRaw ? JSON.parse(steerRaw).message.content : 'NONE'
  const match = steered.match(/<bot-message>\\n([\\s\\S]*?)\\n<\\/bot-message>/)
  const payload = match ? JSON.parse(match[1]) : steered.slice(0, 40)
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: 'STEER_OK:' + payload })
  process.exit(0)
}

if (prompt.includes('MODE:MCP')) {
  emit({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo build' } }] } })
  const mcp = JSON.parse(readFileSync(mcpPath!, 'utf8')).mcpServers.lilbot_system
  const rpc = async (id: number, method: string, params?: unknown) => {
    const res = await fetch(mcp.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...mcp.headers },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
    })
    return (await res.json()) as any
  }
  const listed = await rpc(1, 'tools/list')
  const toolNames = (listed.result?.tools ?? []).map((t: any) => t.name).sort()
  const exMatch = prompt.match(/exchange ([0-9a-f-]{36})/i)
  const itemId = exMatch?.[1] ?? ''
  const workAdd = await rpc(2, 'tools/call', {
    name: 'lilbot_work',
    arguments: { requestId: 'rw-ev-1', itemId, done: 'Build green', evidence: [{ proves: 'Remote build green', command: 'echo build', output: 'ok' }] }
  })
  const memSave = await rpc(3, 'tools/call', { name: 'lilbot_memory_save', arguments: { text: 'Remote worker saved a durable fact.' } })
  const nested = await rpc(4, 'tools/call', { name: 'lilbot_delegate', arguments: { requestId: 'n1', tasks: [{ worker: true, task: 'nest' }] } })
  const otherWork = await rpc(5, 'tools/call', {
    name: 'lilbot_work',
    arguments: { requestId: 'rw-ev-bad', itemId: 'other-item', evidence: [{ proves: 'bad', command: 'echo', output: 'x' }] }
  })
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: sessionId,
    result: JSON.stringify({
      ok: true,
      model,
      effort,
      resume,
      hasSys: sysPrompt.includes('REMOTE_MARKER'),
      toolCount: toolNames.length,
      workOk: !workAdd.result?.isError && !workAdd.error,
      memOk: !memSave.result?.isError && !memSave.error,
      nestedRefused: Boolean(nested.result?.isError || nested.error),
      otherWorkRefused: Boolean(otherWork.result?.isError || otherWork.error)
    })
  })
  process.exit(0)
}

emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: JSON.stringify({ ok: true, model, effort, resume }) })
`

export function writeDelegationFakeClaude(dir: string, filename = 'claude'): string {
  const path = join(dir, filename)
  writeFileSync(path, SCRIPT, { mode: 0o700 })
  return path
}

export function makeCoreFixture(root: string, botDefs: Array<{ id: string; name: string; model: BotModel; instructions?: string; engineId?: string }>) {
  const db = openDatabase(join(root, 'lilbot.db'))
  const bots = new BotStore(db)
  for (const [i, def] of botDefs.entries())
    bots.save({
      id: def.id,
      engineId: def.engineId ?? 'fake',
      engineBotId: def.id,
      name: def.name,
      function: '',
      instructions: def.instructions ?? '',
      model: def.model,
      reasoningEffort: 'medium',
      isDefault: i === 0,
      permissionMode: 'full-access'
    })
  const compStore = new ComputerStore(db)
  const serverKey = loadServerKey(root)
  const computers = new ComputerService(
    compStore,
    serverKey,
    id => bots.exists(id),
    id => join(root, 'ws', id),
    () => {},
    () => 'full-access'
  )
  const memory = new MemoryService(new MemoryStore(db))
  const skills = new SkillsService(join(root, 'skills'), db)
  const addComputer = (name: string, online: boolean, withWorker: boolean, id = `comp-${crypto.randomUUID().slice(0, 8)}`) => {
    const pair = generateKeyPairSync('ed25519')
    compStore.add(
      id,
      {
        name,
        os: 'darwin',
        home: root,
        capabilities: withWorker ? ['exec', 'worker'] : ['exec'],
        ...(withWorker ? { workerAgents: [{ driver: 'claude-code' as const, version: '2.1.327' }] } : {})
      },
      pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    )
    if (online)
      computers.connect(
        id,
        () => {},
        () => {}
      )
    return { id, pair }
  }
  return { db, bots, compStore, serverKey, computers, memory, skills, addComputer }
}
