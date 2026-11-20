/** Taking this computer out of service (signed revoke, `reset`). The key goes first: if removing the service is
 *  interrupted, a helper that starts again finds no identity and stays idle instead of crash-looping. */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { configDir } from './identity'
import { service } from './service'

const real = { removeIdentity: () => rmSync(join(configDir, 'identity.json'), { force: true }), uninstall: () => service('uninstall') }

export async function retire(steps: { removeIdentity(): void; uninstall(): Promise<void> } = real) {
  steps.removeIdentity()
  await steps.uninstall()
}
