/** Compiled entry point. Install codes are read from stdin or a hidden TTY prompt, never argv or logs. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HelperUserError, readInstallCode } from './code-prompt'
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
      const code = await readInstallCode()
      try {
        await register(url, code)
      } catch {
        throw new HelperUserError('Registration was refused. The code may have expired or already been used — create a new command in LilBot.')
      }
    }
    if (action === 'install') {
      try {
        await service('install')
      } catch {
        throw new HelperUserError('Registered with LilBot, but could not start the background service. Check your user service manager and run install again.')
      }
    }
    console.log(action === 'install' ? 'LilBot helper installed and running.' : 'LilBot helper registered.')
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
} catch (error) {
  // No request, credential, shell output, or raw exception payload is logged.
  if (error instanceof HelperUserError) console.error(error.message)
  else console.error('LilBot helper failed. Check the server address, install code, configuration and service manager.')
  process.exitCode = 1
}
