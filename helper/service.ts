import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { configDir } from './identity'

const label = 'info.lilbot.helper'
const xml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
type UninstallStep = { args: string[]; required?: boolean } | { remove: string }

/** Everything is best effort and the step that stops the running helper comes last, so a failure cannot leave a
 *  half-removed service restarting a helper that has no identity (the helper may be the process being stopped). */
export function uninstallPlan(mac: boolean, uid: number, path: string): UninstallStep[] {
  if (mac) return [{ remove: path }, { args: ['launchctl', 'bootout', `gui/${uid}/${label}`] }]
  return [
    { args: ['systemctl', '--user', 'disable', 'lilbot-helper.service'] },
    { remove: path },
    { args: ['systemctl', '--user', 'daemon-reload'] },
    { args: ['systemctl', '--user', 'stop', 'lilbot-helper.service'] }
  ]
}

export interface UninstallEnv {
  mac?: boolean
  home?: string
  uid?: number
  command?: (args: string[]) => Promise<void>
}

export async function uninstallService(env: UninstallEnv = {}) {
  const mac = env.mac ?? process.platform === 'darwin'
  if (!mac && env.mac === undefined && process.platform !== 'linux') throw new Error('Only macOS and Linux are supported.')
  const home = env.home ?? homedir()
  const uid = env.uid ?? process.getuid!()
  const directory = mac ? join(home, 'Library', 'LaunchAgents') : join(home, '.config', 'systemd', 'user')
  const path = join(directory, mac ? `${label}.plist` : 'lilbot-helper.service')
  const run =
    env.command ??
    (async (args: string[]) => {
      await Bun.spawn(args, { stdout: 'ignore', stderr: 'ignore' }).exited
    })
  for (const step of uninstallPlan(mac, uid, path)) {
    if ('remove' in step) await rm(step.remove, { force: true })
    else await run(step.args)
  }
}

export async function service(action: 'install' | 'uninstall') {
  if (action === 'uninstall') return uninstallService()
  const binary = join(configDir, 'lilbot-helper')
  const mac = process.platform === 'darwin'
  if (!mac && process.platform !== 'linux') throw new Error('Only macOS and Linux are supported.')
  const directory = mac ? join(homedir(), 'Library', 'LaunchAgents') : join(homedir(), '.config', 'systemd', 'user')
  const path = join(directory, mac ? `${label}.plist` : 'lilbot-helper.service')
  const command = async (args: string[], required = true) => {
    const child = Bun.spawn(args, { stdout: 'ignore', stderr: 'ignore' })
    if ((await child.exited) !== 0 && required) throw new Error('Service manager refused the operation.')
  }
  await mkdir(directory, { recursive: true })
  if (mac) await command(['launchctl', 'bootout', `gui/${process.getuid!()}`, path], false)
  else await command(['systemctl', '--user', 'stop', 'lilbot-helper.service'], false)
  if (process.execPath !== binary) await installBinary(process.execPath, binary)
  if (mac) {
    await writeFile(
      path,
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(binary)}</string><string>run</string></array>
<key>EnvironmentVariables</key><dict><key>LILBOT_HELPER_CONFIG_DIR</key><string>${xml(configDir)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer></dict></plist>`
    )
    await command(['launchctl', 'bootout', `gui/${process.getuid!()}`, path], false)
    await command(['launchctl', 'bootstrap', `gui/${process.getuid!()}`, path])
  } else {
    const quote = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', '$$')}"`
    await writeFile(
      path,
      `[Unit]\nDescription=LilBot helper\n[Service]\nExecStart=${quote(binary)} run\nEnvironment=${quote(`LILBOT_HELPER_CONFIG_DIR=${configDir}`)}\nRestart=always\nRestartSec=5\nKillMode=control-group\n[Install]\nWantedBy=default.target\n`
    )
    await command(['systemctl', '--user', 'daemon-reload'])
    await command(['systemctl', '--user', 'enable', '--now', 'lilbot-helper.service'])
  }
}

/** Inside the macOS app the checksum sits in Resources, because Contents/MacOS holds only code. */
const checksumFile = (source: string) =>
  /\.app\/Contents\/MacOS\/[^/]+$/.test(source) ? join(dirname(dirname(source)), 'Resources', `${basename(source)}.sha256`) : `${source}.sha256`
export async function installBinary(source: string, target: string) {
  const checksum = (await Bun.file(checksumFile(source)).text()).trim().split(/\s+/)[0]
  const digest = (bytes: ArrayBuffer) => createHash('sha256').update(Buffer.from(bytes)).digest('hex')
  if (!/^[a-f0-9]{64}$/.test(checksum) || digest(await Bun.file(source).arrayBuffer()) !== checksum) throw new Error('Helper checksum mismatch.')
  const temporary = `${target}.${crypto.randomUUID()}.tmp`
  try {
    await copyFile(source, temporary)
    if (digest(await Bun.file(temporary).arrayBuffer()) !== checksum) throw new Error('Helper checksum mismatch.')
    await chmod(temporary, 0o700)
    // The user opened the downloaded app; launchd must not stop at the copy's quarantine mark.
    if (process.platform === 'darwin') await Bun.spawn(['/usr/bin/xattr', '-d', 'com.apple.quarantine', temporary], { stdout: 'ignore', stderr: 'ignore' }).exited
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}
