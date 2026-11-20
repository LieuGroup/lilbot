/** Compiled entry point. Install codes are read from stdin, never argv or logs. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { configDir, loadIdentity, register } from './identity'
import { retire } from './retire'
import { run } from './runner'
import { service } from './service'
import { assertBakedDoor, bakedSettings, HELPER_VERSION } from './settings'
import { link, setup } from './setup'
import { setupWindow } from './setup-window'

try {
  // Opening a downloaded helper (no arguments) starts its setup.
  const action = process.argv[2] ?? (bakedSettings ? 'setup' : undefined)
  if (action === 'register' || action === 'install') {
    if (!existsSync(join(configDir, 'identity.json'))) {
      const url = process.argv[3]
      if (!url) throw new Error('Usage: lilbot-helper install|register https://helper-origin (install code on stdin)')
      assertBakedDoor(url, bakedSettings)
      const code = (await Bun.stdin.text()).trim()
      await register(url, code)
    }
    if (action === 'install') await service('install')
    console.log(action === 'install' ? 'LilBot helper installed.' : 'LilBot helper registered.')
  } else if ((action === 'setup' || action === 'link') && bakedSettings) {
    if (action === 'setup') await setup(bakedSettings, setupWindow())
    else await link(bakedSettings, (await Bun.stdin.text()).trim(), setupWindow())
    process.exit(0)
  } else if (action === 'version') {
    console.log(HELPER_VERSION)
  } else if (action === 'uninstall') {
    await service('uninstall')
    console.log('Service removed. Remove the computer in LilBot to revoke its key; local identity is retained.')
  } else if (action === 'reset') {
    await retire()
    console.log('Local identity removed. Register again with a fresh install code. Execution receipts retained.')
  } else if (action === 'run') {
    const controller = new AbortController()
    process.on('SIGTERM', () => controller.abort())
    process.on('SIGINT', () => controller.abort())
    await run(loadIdentity(), controller.signal)
  } else throw new Error('Usage: lilbot-helper install|register|run|uninstall|reset|version')
} catch {
  // No request, credential, shell output, or exception payload is logged.
  console.error('LilBot helper failed. Check the server address, install code, configuration and service manager.')
  process.exitCode = 1
}
