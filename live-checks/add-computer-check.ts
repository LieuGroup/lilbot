import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
/** "Add this computer" on Linux, as the browser does it: a dev server, the downloaded helper opened with a stub
 *  service manager under a throwaway HOME, a wrong-origin refusal, the page's loopback hand-over and the computer
 *  coming online. Never installs a service or touches a real bot. */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { browser, eventually } from './computers-client'

const scratch = devScratch('lilbot-add-computer')
const port = devPort()
const doorPort = devPort()
const page = `http://127.0.0.1:${port}`
const home = join(scratch, 'home')
const configDir = join(home, '.config', 'lilbot-helper')
const realUnit = join(homedir(), '.config', 'systemd', 'user', 'lilbot-helper.service')
const hadRealUnit = existsSync(realUnit)
const logs: Promise<string>[] = []
const spawn = (command: string[], env: Record<string, string | undefined>) => {
  const child = Bun.spawn(command, { env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  logs.push(new Response(child.stdout).text(), new Response(child.stderr).text())
  return child
}
const children: ReturnType<typeof Bun.spawn>[] = []
let client: Awaited<ReturnType<typeof browser>> | undefined
try {
  mkdirSync(join(scratch, 'bin'), { recursive: true })
  writeFileSync(join(scratch, 'bin', 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const helperEnv = { ...process.env, HOME: home, PATH: `${scratch}/bin:${process.env.PATH}`, LILBOT_HELPER_CONFIG_DIR: configDir }
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
  if (await build.exited) throw new Error('Building the downloads failed')
  client = await browser(port)
  const call = client.call
  const phone = await call('computers.addThis.start', { name: 'Phone', system: { os: 'ios', arch: 'arm64' } })
  if (phone.supported || phone.reason !== 'system') throw new Error('An iPhone was offered a helper')
  const attempt = await call('computers.addThis.start', { name: 'Handover check', system: { os: 'linux', arch: 'x64' } })
  if (!attempt.supported || attempt.downloads[0].fileName !== 'lilbot-helper-linux-x64.tar.gz') throw new Error('No Linux download offered')
  console.log('PASS: unsupported system refused; Linux x64 download offered')

  const url = page + attempt.downloads[0].url
  const download = await fetch(url, { headers: { origin: page, 'sec-fetch-site': 'same-origin' } })
  if (!download.ok) throw new Error('Download refused')
  await Bun.write(join(scratch, 'download.tar.gz'), download)
  if ((await fetch(url, { headers: { 'sec-fetch-site': 'cross-site' } })).status !== 403) throw new Error('Cross-site download allowed')
  if ((await fetch(`http://127.0.0.1:${doorPort}${attempt.downloads[0].url}`)).status !== 404) throw new Error('Helper door served a download')
  mkdirSync(join(scratch, 'opened'))
  if (await Bun.spawn(['tar', '-xzf', join(scratch, 'download.tar.gz'), '-C', join(scratch, 'opened')]).exited) throw new Error('Unpacking failed')
  console.log('PASS: downloaded from the private app only, never cross-site or through the helper door')

  // Opened with no arguments, as from a file manager: it waits for the page.
  const opened = spawn([join(scratch, 'opened', 'lilbot-helper')], helperEnv)
  children.push(opened)
  const helper = `http://127.0.0.1:${new URL(attempt.handoverUrl).port}`
  const hello = (origin: string) => fetch(`${helper}/v1/hello`, { headers: { origin } }).catch(() => null)
  await eventually(async () => (await hello(page))?.ok === true)
  const handOver = (origin: string) =>
    fetch(`${helper}/v1/handover`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ code: attempt.code }) })
  for (const origin of ['https://evil.example', `http://127.0.0.1:${devPort()}`]) {
    for (const response of [await hello(origin), await handOver(origin)]) {
      if (response?.status !== 403 || response.headers.get('access-control-allow-origin')) throw new Error(`Hand-over answered ${origin}`)
    }
  }
  if ((await call('computers.addThis.status', { attemptId: attempt.attemptId })).state !== 'waiting') throw new Error('Wrong origin moved the attempt')
  console.log('PASS: another origin can neither read nor complete the hand-over')

  const accepted = await handOver(page)
  if (!accepted.ok || accepted.headers.get('access-control-allow-origin') !== page) throw new Error('Hand-over refused')
  await eventually(async () => (await call('computers.addThis.status', { attemptId: attempt.attemptId })).state === 'registered')
  if ((await opened.exited) !== 0) throw new Error('Helper setup failed')
  if (!existsSync(join(home, '.config', 'systemd', 'user', 'lilbot-helper.service')) || !existsSync(join(configDir, 'lilbot-helper'))) throw new Error('Service not prepared')
  if (existsSync(realUnit) !== hadRealUnit) throw new Error('A real user unit was written')
  if ((await handOver(page).catch(() => null))?.ok) throw new Error('Hand-over accepted twice')
  console.log('PASS: page hand-over registered the helper and prepared its service under the throwaway HOME')

  // What the service manager would start.
  children.push(spawn([join(configDir, 'lilbot-helper'), 'run'], helperEnv))
  await eventually(async () => (await call('computers.addThis.status', { attemptId: attempt.attemptId })).state === 'connected')
  const status = await call('computers.addThis.status', { attemptId: attempt.attemptId })
  if (status.computer.name !== 'Handover check' || !status.computer.online) throw new Error('Wrong computer')
  console.log(`PASS: "${status.computer.name}" online; attempt state connected`)
  await call('computers.remove', { computer: status.computer.id })
  for (const child of children) child.kill()
  await Promise.all(children.map(child => child.exited))
  const output = (await Promise.all(logs)).join('\n')
  if (output.includes(attempt.code) || readFileSync(join(configDir, 'identity.json'), 'utf8').includes(attempt.code)) throw new Error('The code reached a log')
  console.log('PASS: the code appears in no server or helper output and in no download URL')
} finally {
  client?.close()
  for (const child of children) child.kill()
  await Promise.all(children.map(child => child.exited))
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
