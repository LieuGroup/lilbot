/** Claude Code CLI worker driver: detection and process-group lifecycle.
 *  Uses whatever sign-in the machine already has (no LilBot-managed provider key file) and keeps Claude Code's
 *  own session files in place so `--resume <session_id>` works for follow-ups and post-interrupt recovery. */
import { existsSync, rmSync, statSync } from 'node:fs'
import { extractSafeVersion, runProbeCommand } from './worker-bin'
import { cleanupStaleWorkerConfigs, readBoundedLines, readTailText, resolveClaudeBinary, writeRunMcpConfig } from './worker-claude-env'
import { buildClaudeArgs, claudeUserLine, createClaudeStreamState, parseClaudeLine } from './worker-claude-protocol'
import type { WorkerDriver, WorkerHandle, WorkerOutcome } from './worker-driver'
import { cleanAgentText, expandWorkerCwd } from './worker-text'

const MAX_STDOUT_LINE_CHARS = 2 * 1024 * 1024
const children = new Set<number>()
process.on('exit', () => {
  for (const pid of children) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {}
  }
})

const failedHandle = (error: string): WorkerHandle => ({
  steer: async () => 'not_running',
  stop: () => {},
  done: Promise.resolve({ status: 'failed', text: '', items: [], error })
})

const killProcessGroup = (pid: number, sig: 'SIGTERM' | 'SIGKILL', fallback?: () => void) => {
  try {
    process.kill(-pid, sig)
  } catch {
    fallback?.()
  }
}

export function claudeCodeDriver(options: { bin?: string; configDir?: string; killGraceMs?: number; drainTimeoutMs?: number; platform?: NodeJS.Platform } = {}): WorkerDriver {
  const killGraceMs = options.killGraceMs ?? 2000
  const drainTimeoutMs = options.drainTimeoutMs ?? 2000
  const targetPlatform = options.platform ?? process.platform
  return {
    id: 'claude-code',
    legacyDefault: true,
    cleanupStale(configDir?: string) {
      cleanupStaleWorkerConfigs(configDir ?? options.configDir)
    },
    async detect() {
      const bin = resolveClaudeBinary(options.bin)
      if (!bin) return null
      // Skip `claude auth status --json` on macOS so a login LaunchAgent never triggers a login Keychain prompt.
      // Note: on Linux, Claude Code itself may write a small default `.claude/.claude.json` into an empty HOME.
      const [ver, auth] = await Promise.all([
        runProbeCommand(bin, ['--version']),
        targetPlatform === 'darwin' ? Promise.resolve(null) : runProbeCommand(bin, ['auth', 'status', '--json'])
      ])
      if (ver?.code !== 0) return null
      const version = extractSafeVersion(ver.stdout)
      let signedIn: boolean | undefined
      if (auth) {
        try {
          const parsed = JSON.parse(auth.stdout) as { loggedIn?: unknown }
          if (typeof parsed?.loggedIn === 'boolean') signedIn = parsed.loggedIn
        } catch {}
      }
      return { driver: 'claude-code', version, supported: true, ...(signedIn !== undefined ? { signedIn } : {}) }
    },
    start(request, onEvent): WorkerHandle {
      const bin = resolveClaudeBinary(options.bin)
      const secret = request.mcp?.token
      const cwd = expandWorkerCwd(request.cwd)
      if (!bin) return failedHandle('Claude Code is not installed on this computer.')
      let mcpConfigPath = ''
      let child: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | undefined
      try {
        if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return failedHandle('Working directory does not exist.')
        mcpConfigPath = writeRunMcpConfig(options.configDir, request.runId, request.mcp)
        const args = buildClaudeArgs(request, mcpConfigPath)
        child = Bun.spawn([bin, ...args], { cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', detached: true })
        children.add(child.pid)
        child.stdin.write(claudeUserLine(request.prompt))
        void child.stdin.flush()
      } catch (error) {
        if (child) {
          killProcessGroup(child.pid, 'SIGKILL', () => child?.kill('SIGKILL'))
          children.delete(child.pid)
        }
        if (mcpConfigPath) rmSync(mcpConfigPath, { force: true })
        return failedHandle(cleanAgentText(error instanceof Error ? error.message : 'Failed to start coding agent.', 300, secret))
      }

      const proc = child
      const state = createClaudeStreamState()
      let stopped = false
      let exited = false
      let stdinEnded = false
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
      const endStdin = () => {
        if (stdinEnded) return
        stdinEnded = true
        try {
          proc.stdin.end()
        } catch {}
      }
      const stop = () => {
        if (stopped || exited) return
        stopped = true
        endStdin()
        killProcessGroup(proc.pid, 'SIGTERM', () => proc.kill('SIGTERM'))
        killTimer = setTimeout(() => {
          if (!exited) killProcessGroup(proc.pid, 'SIGKILL', () => proc.kill('SIGKILL'))
        }, killGraceMs)
      }
      const handleLine = (line: string) => {
        try {
          const event = parseClaudeLine(line, state, secret)
          if (event) onEvent(event)
          if (state.resultSeen) endStdin()
        } catch {}
      }

      const done: Promise<WorkerOutcome> = (async () => {
        let stderr = ''
        const drain = Promise.all([
          readBoundedLines(proc.stdout, readers, MAX_STDOUT_LINE_CHARS, handleLine).catch(() => {}),
          readTailText(proc.stderr, readers, 4096)
            .then(s => {
              stderr = s
            })
            .catch(() => {})
        ])
        try {
          await proc.exited
          exited = true
          let drainTimer: ReturnType<typeof setTimeout> | undefined
          await Promise.race([
            drain,
            new Promise<void>(resolve => {
              drainTimer = setTimeout(() => {
                for (const r of readers) void r.cancel().catch(() => {})
                resolve()
              }, drainTimeoutMs)
            })
          ])
          if (drainTimer) clearTimeout(drainTimer)
          for (const item of state.tools.values()) item.running = false
          const text = cleanAgentText(state.resultText ?? state.text, 500_000, secret)
          const session = state.sessionId ? { sessionId: state.sessionId } : {}
          if (stopped) return { ...session, status: 'stopped', text, items: state.items, usage: state.usage }
          if (state.resultError || proc.exitCode !== 0 || !state.resultSeen) {
            const fallback =
              proc.exitCode === null ? 'Worker was interrupted.' : proc.exitCode !== 0 ? `Agent exited with code ${proc.exitCode}.` : 'Worker exited without a final result.'
            const reason = cleanAgentText(state.resultError || stderr.trim() || fallback, 1000, secret)
            const status = !state.resultError && !stderr.trim() && proc.exitCode === null ? 'interrupted' : 'failed'
            return { ...session, status, text, items: state.items, usage: state.usage, error: reason }
          }
          return { ...session, status: 'completed', text, items: state.items, usage: state.usage }
        } finally {
          if (!exited) killProcessGroup(proc.pid, 'SIGKILL', () => proc.kill('SIGKILL'))
          exited = true
          for (const reader of readers) void reader.cancel().catch(() => {})
          if (killTimer) clearTimeout(killTimer)
          children.delete(proc.pid)
          rmSync(mcpConfigPath, { force: true })
        }
      })()

      return {
        async steer(text) {
          if (stopped || exited || stdinEnded) return 'not_running'
          try {
            proc.stdin.write(claudeUserLine(text))
            await proc.stdin.flush()
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
