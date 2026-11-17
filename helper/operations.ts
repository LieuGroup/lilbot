/** Also used by the leader: full user access, bounded files/output and cancellable subprocess groups. */
import { constants } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { ComputerOperation, ComputerResult } from '../shared/computer-schema'
import { boundResult, TRUNCATED } from './result-bounds'

const children = new Set<number>()
process.on('exit', () => {
  for (const pid of children) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {}
  }
})
const LIMIT = 4 * 1024 * 1024
export async function operate(op: ComputerOperation, signal: AbortSignal, progress: (result: ComputerResult) => void = () => {}): Promise<ComputerResult> {
  signal.throwIfAborted()
  if (op.kind === 'exec') return execute(op, signal, progress)
  if (op.kind === 'list') {
    const entries = await readdir(op.path, { withFileTypes: true })
    return boundResult({
      output:
        JSON.stringify(entries.slice(0, 10_000).map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other' }))) +
        (entries.length > 10_000 ? '\n[Result truncated]' : '')
    })
  }
  const flags = op.kind === 'read' ? constants.O_RDONLY : constants.O_WRONLY | constants.O_CREAT
  const file = await open(op.path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new Error('Only regular files are supported.')
    if (op.kind === 'write') {
      const data = Buffer.from(op.data, op.encoding)
      if (data.length > LIMIT) throw new Error('File exceeds 4 MiB.')
      await file.truncate(0)
      await file.writeFile(data)
      return { output: `Wrote ${data.length} bytes.` }
    }
    if (stat.size > LIMIT) throw new Error('File exceeds 4 MiB.')
    const buffer = Buffer.alloc(LIMIT + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > LIMIT) throw new Error('File exceeds 4 MiB.')
    return { output: buffer.subarray(0, bytesRead).toString('base64') }
  } finally {
    await file.close()
  }
}
async function execute(op: Extract<ComputerOperation, { kind: 'exec' }>, signal: AbortSignal, progress: (result: ComputerResult) => void): Promise<ComputerResult> {
  // A separate shell watchdog survives an abrupt helper death (including SIGKILL).
  // It shares the command's process group and kills that group if its owner disappears.
  const wrapper = `owner=$1; shift; group=$$; (while kill -0 "$owner" 2>/dev/null; do sleep 1; done; kill -9 -"$group") </dev/null >/dev/null 2>&1 & guard=$!; "$@"; status=$?; kill "$guard" 2>/dev/null; wait "$guard" 2>/dev/null; exit "$status"`
  const child = Bun.spawn(['/bin/sh', '-c', wrapper, 'lilbot-command', String(process.pid), process.env.SHELL || '/bin/sh', '-lc', op.command], {
    cwd: op.cwd || homedir(),
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true
  })
  children.add(child.pid)
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  let stopped = false
  const stop = () => {
    stopped = true
    for (const reader of readers) void reader.cancel().catch(() => {})
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill()
    }
  }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  const timer = setTimeout(stop, op.timeoutMs)
  let output = ''
  let truncated = false
  let lastProgress = 0
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    const reader = stream.getReader()
    readers.push(reader)
    if (stopped) {
      await reader.cancel()
      return
    }
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      const next = output + decoder.decode(chunk, { stream: true })
      truncated ||= next.length > 200_000
      output = next.slice(-200_000)
      if (Date.now() - lastProgress > 1000) {
        progress({ output: (truncated || output.length > 4096 ? TRUNCATED : '') + output.slice(-4096) })
        lastProgress = Date.now()
      }
    }
  }
  try {
    await Promise.all([read(child.stdout), read(child.stderr), child.exited])
    return { output: truncated ? TRUNCATED + output : output, exitCode: child.exitCode, ...(stopped ? { error: signal.aborted ? 'Cancelled.' : 'Command timed out.' } : {}) }
  } finally {
    children.delete(child.pid)
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
  }
}
