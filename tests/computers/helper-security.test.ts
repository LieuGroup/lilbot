import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { operate } from '../../helper/operations'
import { installBinary } from '../../helper/service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'helper-security-'))
  roots.push(root)
  return { root }
}
test('atomic helper replacement verifies checksum before replacing an executing file', async () => {
  const { root } = fixture()
  const target = join(root, 'target')
  const source = join(root, 'source')
  writeFileSync(target, '#!/bin/sh\nsleep 20\n', { mode: 0o700 })
  writeFileSync(source, '#!/bin/sh\nexit 0\n')
  writeFileSync(`${source}.sha256`, createHash('sha256').update(readFileSync(source)).digest('hex'))
  const child = Bun.spawn([target], { stdout: 'ignore', stderr: 'ignore' })
  try {
    await installBinary(source, target)
    expect(readFileSync(target, 'utf8')).toContain('exit 0')
    writeFileSync(source, 'changed')
    await expect(installBinary(source, target)).rejects.toThrow('checksum')
    expect(readFileSync(target, 'utf8')).toContain('exit 0')
  } finally {
    child.kill()
    await child.exited
  }
})
test('escaped grandchild holding pipes cannot defeat timeout', async () => {
  // The child is in another process group, but exits soon so no test process is left behind.
  const start = Date.now()
  const result = await operate({ kind: 'exec', command: "setsid sh -c 'sleep 2' & wait", timeoutMs: 100 }, new AbortController().signal)
  expect(result.error).toBe('Command timed out.')
  expect(Date.now() - start).toBeLessThan(1500)
})

test('abrupt helper death stops its tracked command group', async () => {
  const { root } = fixture()
  const pidFile = join(root, 'command-pid')
  const module = join(import.meta.dir, '../../helper/operations.ts')
  const code = `import { operate } from ${JSON.stringify(module)}; await operate({kind:'exec',command:${JSON.stringify(`echo $$ > '${pidFile}'; exec sleep 120`)},timeoutMs:120000}, new AbortController().signal)`
  const owner = Bun.spawn(['bun', '-e', code], { stdout: 'ignore', stderr: 'ignore' })
  let pid = 0
  try {
    const until = Date.now() + 3000
    while (!pid && Date.now() < until) {
      try {
        pid = Number(readFileSync(pidFile, 'utf8').trim())
      } catch {}
      await Bun.sleep(25)
    }
    expect(pid).toBeGreaterThan(0)
    owner.kill('SIGKILL')
    await owner.exited
    const ended = () => {
      try {
        return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z')
      } catch {
        return true
      }
    }
    const deadline = Date.now() + 2500
    while (!ended() && Date.now() < deadline) await Bun.sleep(25)
    expect(ended()).toBe(true)
  } finally {
    owner.kill()
    await owner.exited
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
  }
})

test('large directory and exec results carry truncation markers', async () => {
  const { mkdirSync } = await import('node:fs')
  const { root } = fixture()
  for (let i = 0; i < 10_001; i++) mkdirSync(join(root, String(i)))
  const listing = await operate({ kind: 'list', path: root }, new AbortController().signal)
  expect(listing.output).toEndWith('[Result truncated]')
  const exec = await operate({ kind: 'exec', command: 'head -c 300000 /dev/zero', timeoutMs: 1000 }, new AbortController().signal)
  expect(exec.output).toStartWith('\n[Result truncated]')
})
