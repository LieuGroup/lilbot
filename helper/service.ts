import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { configDir } from './identity'

const label = 'info.lilbot.helper'
const xml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
export async function service(action: 'install' | 'uninstall') {
  const binary = join(configDir, 'lilbot-helper')
  const mac = process.platform === 'darwin'
  if (!mac && process.platform !== 'linux') throw new Error('Only macOS and Linux are supported.')
  const directory = mac ? join(homedir(), 'Library', 'LaunchAgents') : join(homedir(), '.config', 'systemd', 'user')
  const path = join(directory, mac ? `${label}.plist` : 'lilbot-helper.service')
  const command = async (args: string[], required = true) => {
    const child = Bun.spawn(args, { stdout: 'ignore', stderr: 'ignore' })
    if ((await child.exited) !== 0 && required) throw new Error('Service manager refused the operation.')
  }
  if (action === 'uninstall') {
    if (mac) await command(['launchctl', 'bootout', `gui/${process.getuid!()}`, path], false)
    else await command(['systemctl', '--user', 'disable', '--now', 'lilbot-helper.service'], false)
    await rm(path, { force: true })
    if (!mac) await command(['systemctl', '--user', 'daemon-reload'])
    return
  }
  await mkdir(directory, { recursive: true })
  if (process.execPath !== binary) await copyFile(process.execPath, binary)
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
