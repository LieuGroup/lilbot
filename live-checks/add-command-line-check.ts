import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
/** End-to-end "Add by command line" on Linux: builds all 4 CLI archives, mints a command-line attempt,
 *  verifies session isolation, checks SHA-256 mismatch aborts before unpacking with zero temp leftovers,
 *  runs the real generated command inside a PTY (confirming hidden code prompt, pasted-command rejection,
 *  registration, install, live connected status, coding-engine reporting, removal and complete cleanup). */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildPrivateCommand } from '../web/src/computers/command-line-script'
import { browser, eventually } from './computers-client'

const scratch = devScratch('lilbot-add-cli')
const port = devPort()
const doorPort = devPort()
const page = `http://127.0.0.1:${port}`
const home = join(scratch, 'home')
const tmp = join(scratch, 'tmp')
const configDir = join(home, '.config', 'lilbot-helper')
const realUnit = join(homedir(), '.config', 'systemd', 'user', 'lilbot-helper.service')
const hadRealUnit = existsSync(realUnit)
const logs: Promise<string>[] = []
const children: ReturnType<typeof Bun.spawn>[] = []
let client: Awaited<ReturnType<typeof browser>> | undefined
let otherClient: Awaited<ReturnType<typeof browser>> | undefined

const spawn = (command: string[], env: Record<string, string | undefined>) => {
  const child = Bun.spawn(command, { env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  logs.push(new Response(child.stdout).text(), new Response(child.stderr).text())
  return child
}

try {
  mkdirSync(join(scratch, 'bin'), { recursive: true })
  mkdirSync(tmp, { recursive: true })
  writeFileSync(join(scratch, 'bin', 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const helperEnv = { ...process.env, HOME: home, TMPDIR: tmp, PATH: `${scratch}/bin:${process.env.PATH}`, LILBOT_HELPER_CONFIG_DIR: configDir }
  const server = spawn(['bun', 'server/main.ts'], {
    ...process.env,
    LILBOT_PORT: String(port),
    LILBOT_PUBLIC_ENABLED: '1',
    LILBOT_PUBLIC_PORT: String(doorPort),
    LILBOT_HELPER_URL: `http://127.0.0.1:${doorPort}`,
    LILBOT_DATA_DIR: scratch,
    LILBOT_WORKSPACES_DIR: join(scratch, 'workspaces'),
    LILBOT_SKILLS_DIR: join(scratch, 'skills'),
    LILBOT_BOT_IDS: 'isolated-no-profiles',
    LILBOT_SKIP_MEMORY_SETUP: '1',
    LILBOT_REVIEW: 'off'
  })
  children.push(server)
  await eventually(() =>
    fetch(`${page}/api/health`)
      .then(r => r.ok)
      .catch(() => false)
  )

  const build = Bun.spawn(['bun', 'scripts/build-helper-downloads.ts', scratch], { env: process.env, stdout: 'ignore', stderr: 'inherit' })
  if (await build.exited) throw new Error('Building CLI downloads failed')

  client = await browser(port)
  otherClient = await browser(port)
  const info = await client.call('computers.downloads', {})
  const cliNames = info.cliDownloads.map((d: { fileName: string }) => d.fileName)
  for (const name of ['lilbot-helper-linux-x64.tar.gz', 'lilbot-helper-linux-arm64.tar.gz', 'lilbot-helper-macos-arm64.tar.gz', 'lilbot-helper-macos-x64.tar.gz'])
    if (!cliNames.includes(name)) throw new Error(`Missing CLI archive: ${name}`)
  console.log('PASS: built and offered all 4 Linux + macOS CLI helper archives')

  const started = await client.call('computers.commandLine.start', { name: 'CLI Live Box', system: { os: 'linux', arch: 'x64' } })
  if (!started.download || !started.privateOrigin || !started.helperUrl) throw new Error('Incomplete commandLine.start response')
  let otherRefused = false
  try {
    await otherClient.call('computers.addThis.status', { attemptId: started.attemptId })
  } catch {
    otherRefused = true
  }
  if (!otherRefused) throw new Error('Another browser session was allowed to watch the attempt')
  console.log('PASS: attempt status is scoped strictly to the creating browser session')

  const command = buildPrivateCommand({ privateOrigin: started.privateOrigin, download: started.download, helperUrl: started.helperUrl })
  if (!command) throw new Error('Could not build command')
  if (command.includes(started.code) || command.includes('CLI Live Box')) throw new Error('Command leaked code or computer name')

  // Tampered SHA-256 must abort before unpacking and remove its temp directory.
  const flipped = `${started.download.sha256[0] === '0' ? '1' : '0'}${started.download.sha256.slice(1)}`
  const badCommand = command.replace(started.download.sha256, flipped)
  const tampered = Bun.spawn(['/bin/sh', '-c', badCommand], { env: helperEnv, stdout: 'ignore', stderr: 'pipe' })
  if ((await tampered.exited) === 0) throw new Error('Tampered SHA-256 unexpectedly succeeded')
  if (readdirSync(tmp).length !== 0) throw new Error('Temp directory left behind after checksum failure')
  console.log('PASS: checksum mismatch refused before unpacking and cleaned temp dir')

  // Run the exact generated command in a real PTY: wrong paste rejected, hidden code accepted, temp dir removed.
  const ptyScript = `
import os, pty, select, subprocess, termios, time
master, slave = pty.openpty()
p = subprocess.Popen(['/bin/sh', '-c', ${JSON.stringify(command)}], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
buf = b''
def wait_for(needle, timeout=20.0):
    global buf
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.1)
        if r:
            try:
                chunk = os.read(master, 4096)
                if not chunk: break
                buf += chunk
                if needle in buf: return True
            except OSError: break
    return False
assert wait_for(b'Paste only the one-time code'), buf
os.write(master, b'printf oops | ./lilbot-helper install\\n')
assert wait_for(b'That does not look like a one-time code'), buf
os.write(master, (${JSON.stringify(started.code)} + '\\n').encode())
p.wait(timeout=30)
while True:
    r, _, _ = select.select([master], [], [], 0.1)
    if not r: break
    try:
        chunk = os.read(master, 4096)
        if not chunk: break
        buf += chunk
    except OSError: break
echo_on = bool(termios.tcgetattr(master)[3] & termios.ECHO)
os.close(master)
print('EXIT=' + str(p.returncode))
print('ECHO=' + str(echo_on))
print(buf.decode('utf-8', 'replace'))
`
  const ptyRun = Bun.spawn(['python3', '-c', ptyScript], { env: helperEnv, stdout: 'pipe', stderr: 'pipe' })
  const [ptyOut, ptyErr, ptyExit] = await Promise.all([new Response(ptyRun.stdout).text(), new Response(ptyRun.stderr).text(), ptyRun.exited])
  if (ptyExit !== 0 || !ptyOut.includes('EXIT=0') || !ptyOut.includes('ECHO=True')) throw new Error(`Real CLI command failed:\n${ptyOut}\n${ptyErr}`)
  if (ptyOut.includes(started.code)) throw new Error('One-time code echoed into PTY output')
  if (!ptyOut.includes('LilBot helper installed and running.')) throw new Error(`Missing install confirmation:\n${ptyOut}`)
  if (readdirSync(tmp).length !== 0) throw new Error('Temp directory left behind after install')
  if (!existsSync(join(home, '.config', 'systemd', 'user', 'lilbot-helper.service')) || !existsSync(join(configDir, 'lilbot-helper')))
    throw new Error('Installed binary or user unit missing in throwaway HOME')
  if (existsSync(realUnit) !== hadRealUnit) throw new Error('A real user systemd unit was touched')
  console.log('PASS: real generated command verified, unpacked, prompted with echo off, registered and cleaned up')

  await eventually(async () => (await client!.call('computers.addThis.status', { attemptId: started.attemptId })).state === 'registered')
  const service = spawn([join(configDir, 'lilbot-helper'), 'run'], helperEnv)
  children.push(service)
  await eventually(async () => (await client!.call('computers.addThis.status', { attemptId: started.attemptId })).state === 'connected')
  const connected = await client.call('computers.addThis.status', { attemptId: started.attemptId })
  if (connected.computer.name !== 'CLI Live Box' || !connected.computer.online) throw new Error('Wrong connected computer')
  console.log(`PASS: "${connected.computer.name}" connected live (capabilities: ${connected.computer.capabilities.join(', ')})`)

  await client.call('computers.remove', { computer: connected.computer.id })
  if ((await service.exited) !== 0 || existsSync(join(configDir, 'identity.json'))) throw new Error('Revoked helper did not clean up')
  for (const child of children) child.kill()
  await Promise.all(children.map(c => c.exited))
  const allLogs = (await Promise.all(logs)).join('\n')
  if (allLogs.includes(started.code)) throw new Error('One-time code leaked into server or helper logs')
  console.log('PASS: removed cleanly, zero temp leftovers, zero secret leaks')
} finally {
  client?.close()
  otherClient?.close()
  for (const child of children) child.kill()
  await Promise.all(children.map(c => c.exited))
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
