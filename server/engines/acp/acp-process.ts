/** Spike only: isolated Codex configuration, ChatGPT login only, no inherited API keys. */

import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ClientApp, ndJsonStream, type SessionNotification } from '@agentclientprotocol/sdk'

export function subscriptionHome(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const auth = join(homedir(), '.codex', 'auth.json')
  // Inspect only the authentication kind. Never print or copy credentials.
  const login = JSON.parse(readFileSync(auth, 'utf8'))
  if (login.auth_mode !== 'chatgpt') throw new Error('The spike requires an existing ChatGPT subscription login.')
  const target = join(directory, 'auth.json')
  if (!existsSync(target)) symlinkSync(auth, target)
  if (realpathSync(target) !== realpathSync(auth)) throw new Error('Unexpected ACP credential path.')
  return directory
}

export async function acpProcess(home: string, instructions: string, onUpdate: (event: SessionNotification) => void, onLost: () => void) {
  const child = Bun.spawn([join(import.meta.dir, '../../..', 'node_modules/.bin/codex-acp')], {
    env: {
      HOME: homedir(),
      PATH: process.env.PATH,
      CODEX_HOME: home,
      CODEX_PATH: Bun.which('codex')!,
      INITIAL_AGENT_MODE: 'read-only',
      CODEX_CONFIG: JSON.stringify({
        forced_login_method: 'chatgpt',
        model_provider: 'openai',
        model: 'gpt-6.1-sol',
        model_reasoning_effort: 'low',
        developer_instructions: instructions
      })
    },
    detached: true,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore'
  })
  const output = new WritableStream<Uint8Array>({
    write(bytes) {
      child.stdin.write(bytes)
    },
    close() {
      child.stdin.end()
    }
  })
  let closing = false
  const memoryTools = new Set<string>()
  const connection = new ClientApp()
    .onNotification('session/update', ctx => {
      const update = ctx.params.update
      if (update.sessionUpdate === 'tool_call' && /^mcp\.lilbot-memory\.(recall_memory|update_memory)$/.test(update.title)) memoryTools.add(update.toolCallId)
      onUpdate(ctx.params)
    })
    // Only this temporary bot’s bound memory tools and exact pwd command are approved.
    .onRequest('session/request_permission', ({ params }) => {
      const allowed = memoryTools.has(params.toolCall.toolCallId) || (params.toolCall.rawInput as { command?: string } | undefined)?.command === 'pwd'
      const option = allowed ? params.options.find(o => o.kind === 'allow_once') : undefined
      return { outcome: option ? { outcome: 'selected' as const, optionId: option.optionId } : { outcome: 'cancelled' as const } }
    })
    .connect(ndJsonStream(output, child.stdout))
  void child.exited.then(() => {
    if (!closing) onLost()
  })
  const close = () => {
    closing = true
    connection.close()
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill()
    }
  }
  try {
    const hello = await connection.agent.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'lilbot-acp-spike', version: '0.1' }
      },
      { cancellationSignal: AbortSignal.timeout(15_000), stopWaitingOnCancel: true }
    )
    return { agent: connection.agent, hello, close }
  } catch (error) {
    close()
    throw error
  }
}
