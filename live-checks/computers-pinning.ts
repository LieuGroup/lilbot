import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Identity } from '../helper/identity'
import { ComputerService } from '../server/computers/computer-service'
import { ComputerStore } from '../server/computers/computer-store'
import { loadServerKey } from '../server/computers/server-key'
import { openDatabase } from '../server/database/database'
import { startPublicDoor } from '../server/http/public-door'

/** A second real door has the helper's public key but a different server key. */
export async function checkPinning(binary: string, root: string, config: string, identity: Identity, publicKey: string) {
  const db = openDatabase(':memory:')
  const service = new ComputerService(
    new ComputerStore(db),
    loadServerKey(root),
    () => true,
    () => root,
    () => {},
    () => 'full-access'
  )
  service.store.add(identity.id, { name: 'Test', os: 'linux', home: root, capabilities: ['exec'] }, publicKey)
  const output = join(root, 'pinning-must-not-exist')
  await service.submit('bot', { computer: identity.id, requestId: 'bad-server', operation: { kind: 'exec', command: `printf BAD > '${output}'` }, background: true })
  const door = startPublicDoor(service, 0)
  // Inject the URL only: the saved fingerprint must still reject the other server.
  await Bun.write(join(config, 'identity.json'), JSON.stringify({ ...identity, url: `http://127.0.0.1:${door.port}` }))
  let attempts = 0
  const connect = service.connect.bind(service)
  service.connect = (...args) => {
    attempts++
    return connect(...args)
  }
  const helper = Bun.spawn([binary, 'run'], { env: { ...process.env, LILBOT_HELPER_CONFIG_DIR: config }, stdout: 'ignore', stderr: 'inherit' })
  try {
    const until = Date.now() + 10_000
    while (!attempts && Date.now() < until) await Bun.sleep(100)
    if (!attempts) throw new Error('Pinning test never reached second server')
    await Bun.sleep(750)
    if (existsSync(output) || service.store.pending(identity.id)[0]?.status !== 'running') throw new Error('Helper trusted a different server key')
    console.log('PASS: pinned helper refused work from a second door with a different server key')
  } finally {
    helper.kill()
    await helper.exited
    door.stop(true)
    service.close()
    db.close()
    await Bun.write(join(config, 'identity.json'), JSON.stringify(identity))
  }
}
