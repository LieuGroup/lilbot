/** Claude Code CLI worker driver: detection and process-group lifecycle.
 *  Uses whatever sign-in the machine already has (no LilBot-managed provider key file) and keeps Claude Code's
 *  own session files in place so `--resume <session_id>` works for follow-ups and post-interrupt recovery. */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildClaudeArgs, claudeUserLine, cleanAgentText, createClaudeStreamState, parseClaudeLine } from './worker-claude-protocol'
import type { WorkerDriver, WorkerHandle, WorkerOutcome } from './worker-driver'

const DEFAULT_FALLBACKS = [join(homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
const children = new Set<number>()
process.on('exit', () => {
  for (const pid of children) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {}
  }
})

const expandCwd = (raw: string) => (raw === '~' ? homedir() : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw)

function resolveBinary(explicit?: string): string | null {
  const configured = explicit ?? process.env.LILBOT_WORKER_CLAUDE_BIN
  if (configured !== undefined) return configured.trim() ? (Bun.which(configured) ?? (existsSync(configured) ? configured : null)) : null
  return Bun.which('claude') ?? DEFAULT_FALLBACKS.find(path => existsSync(path)) ?? null
}

const failedHandle = (error: string): WorkerHandle => ({
  steer: async () => 'not_running',
  stop: () => {},
  done: Promise.resolve({ status: 'failed', text: '', items: [], error })
})

export function claudeCodeDriver(options: { bin?: string; configDir?: string; killGraceMs?: number } = {}): WorkerDriver {
  const killGraceMs = options.killGraceMs ?? 2000
  const runDir = () => join(options.configDir ?? process.env.LILBOT_HELPER_CONFIG_DIR ?? join(homedir(), '.config', 'lilbot-helper'), 'worker-runs')
  return {
    id: 'claude-code',
    async detect() {
      const bin = resolveBinary(options.bin)
      if (!bin) return null
      try {
        const child = Bun.spawn([bin, '--version'], { stdout: 'pipe', stderr: 'ignore' })
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
        const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
        clearTimeout(timer)
        if (code !== 0) return null
        const version = cleanAgentText(out.trim().split(/\s+/)[0] ?? '', 64)
        return version ? { driver: 'claude-code', version } : null
      } catch {
        return null
      }
    },
    start(request, onEvent): WorkerHandle {
      const bin = resolveBinary(options.bin)
      const secret = request.mcp?.token
      const cwd = expandCwd(request.cwd)
      if (!bin) return failedHandle('Claude Code is not installed on this computer.')
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return failedHandle('Working directory does not exist.')

      const dir = runDir()
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const mcpConfigPath = join(dir, `${request.runId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)}-${crypto.randomUUID()}.mcp.json`)
      const mcpConfig = request.mcp
        ? { mcpServers: { lilbot_system: { type: 'http', url: request.mcp.url, headers: { Authorization: `Bearer ${request.mcp.token}` } } } }
        : { mcpServers: {} }
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig), { mode: 0o600 })

      const child = Bun.spawn([bin, ...buildClaudeArgs(request, mcpConfigPath)], { cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', detached: true })
      children.add(child.pid)
      const state = createClaudeStreamState()
      let stopped = false
      let exited = false
      let stdinEnded = false
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const endStdin = () => {
        if (stdinEnded) return
        stdinEnded = true
        try {
          child.stdin.end()
        } catch {}
      }
      const killGroup = (sig: 'SIGTERM' | 'SIGKILL') => {
        try {
          process.kill(-child.pid, sig)
        } catch {
          child.kill(sig)
        }
      }
      const stop = () => {
        if (stopped || exited) return
        stopped = true
        endStdin()
        killGroup('SIGTERM')
        killTimer = setTimeout(() => {
          if (!exited) killGroup('SIGKILL')
        }, killGraceMs)
      }
      child.stdin.write(claudeUserLine(request.prompt))
      void child.stdin.flush()

      const done: Promise<WorkerOutcome> = (async () => {
        let stderr = ''
        const readOut = async () => {
          const reader = child.stdout.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          while (true) {
            const { done: eof, value } = await reader.read()
            if (eof) break
            buf += decoder.decode(value, { stream: true })
            let nl = buf.indexOf('\n')
            while (nl !== -1) {
              const event = parseClaudeLine(buf.slice(0, nl), state, secret)
              buf = buf.slice(nl + 1)
              if (event) onEvent(event)
              if (state.resultSeen) endStdin()
              nl = buf.indexOf('\n')
            }
          }
          if (buf.trim()) {
            const event = parseClaudeLine(buf, state, secret)
            if (event) onEvent(event)
          }
        }
        const readErr = async () => {
          const reader = child.stderr.getReader()
          const decoder = new TextDecoder()
          while (true) {
            const { done: eof, value } = await reader.read()
            if (eof) break
            stderr = (stderr + decoder.decode(value, { stream: true })).slice(-4096)
          }
        }
        try {
          await Promise.all([readOut(), readErr(), child.exited])
          exited = true
          for (const item of state.tools.values()) item.running = false
          const text = cleanAgentText(state.resultText ?? state.text, 500_000, secret)
          if (stopped) return { sessionId: state.sessionId, status: 'stopped', text, items: state.items, usage: state.usage }
          if (state.resultError || child.exitCode !== 0) {
            const reason = cleanAgentText(
              state.resultError || stderr.trim() || (child.exitCode === null ? 'Worker was interrupted.' : `Agent exited with code ${child.exitCode}.`),
              1000,
              secret
            )
            const status = !state.resultError && !stderr.trim() && child.exitCode === null ? 'interrupted' : 'failed'
            return { sessionId: state.sessionId, status, text, items: state.items, usage: state.usage, error: reason }
          }
          return { sessionId: state.sessionId, status: 'completed', text, items: state.items, usage: state.usage }
        } finally {
          exited = true
          if (killTimer) clearTimeout(killTimer)
          children.delete(child.pid)
          rmSync(mcpConfigPath, { force: true })
        }
      })()

      return {
        async steer(text) {
          if (stopped || exited || stdinEnded) return 'not_running'
          try {
            child.stdin.write(claudeUserLine(text))
            await child.stdin.flush()
            return 'steered'
          } catch {
            return 'not_running'
          }
        },
        stop,
        done
      }
    }
  }
}
