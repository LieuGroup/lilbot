/** Compiled entry point. Install codes are read from stdin, never argv or logs. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { configDir, loadIdentity, register } from './identity'
import { run } from './runner'
import { service } from './service'

try {
  const action = process.argv[2]
  if (action === 'register' || action === 'install') {
    if (!existsSync(join(configDir, 'identity.json'))) {
      const url = process.argv[3]
      if (!url) throw new Error('Usage: lilbot-helper install|register https://helper-origin (install code on stdin)')
      const code = (await Bun.stdin.text()).trim()
      await register(url, code)
    }
    if (action === 'install') await service('install')
    console.log(action === 'install' ? 'LilBot helper installed.' : 'LilBot helper registered.')
  } else if (action === 'uninstall') {
    await service('uninstall')
    console.log('Service removed. Remove the computer in LilBot to revoke its key; local identity is retained.')
  } else if (action === 'run') {
    const controller = new AbortController()
    process.on('SIGTERM', () => controller.abort())
    process.on('SIGINT', () => controller.abort())
    await run(loadIdentity(), controller.signal)
  } else throw new Error('Usage: lilbot-helper install|register|run|uninstall')
} catch {
  // No request, credential, shell output, or exception payload is logged.
  console.error('LilBot helper failed. Check the server address, install code, configuration and service manager.')
  process.exitCode = 1
}
