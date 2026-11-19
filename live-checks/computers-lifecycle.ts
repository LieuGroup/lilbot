import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComputerService } from '../server/computers/computer-service'
import { ComputerStore } from '../server/computers/computer-store'
import { loadServerKey } from '../server/computers/server-key'
import { openDatabase } from '../server/database/database'
import { startPublicDoor } from '../server/http/public-door'
import { eventually } from './computers-client'

/** Exercises a real helper process and signed server frames without touching any bots. */
export async function checkLifecycle(command: string[], root: string) {
  const db = openDatabase(':memory:')
  const store = new ComputerStore(db)
  const key = loadServerKey(root)
  const makeService = () =>
    new ComputerService(
      store,
      key,
      () => true,
      () => root,
      () => {},
      () => 'full-access'
    )
  let service = makeService()
  const tick = setInterval(() => service.tick(), 100)
  const pair = generateKeyPairSync('ed25519')
  store.add('lifecycle', { name: 'Lifecycle', os: 'linux', home: root, capabilities: ['exec'] }, pair.publicKey.export({ type: 'spki', format: 'pem' }).toString())
  let door = startPublicDoor(service, 0)
  const port = door.port!
  const identity = {
    id: 'lifecycle',
    url: `http://127.0.0.1:${port}`,
    serverFingerprint: key.fingerprint,
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  }
  writeFileSync(join(root, 'identity.json'), JSON.stringify(identity), { mode: 0o600 })
  const originalConnect = service.connect.bind(service)
  service.connect = (id, send, close) => originalConnect(id, send, code => close(code === 1001 ? 1008 : code))
  mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(join(root, 'bin/systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const helper = Bun.spawn([...command, 'run'], {
    env: { ...process.env, HOME: root, PATH: `${root}/bin:${process.env.PATH}`, LILBOT_HELPER_CONFIG_DIR: root },
    stdout: 'ignore',
    stderr: 'inherit'
  })
  try {
    await eventually(async () => service.list().some(c => c.id === identity.id && c.online))
    const start = performance.now()
    const fast = await service.submit('bot', { computer: identity.id, requestId: 'fast', operation: { kind: 'exec', command: 'echo hi' } })
    const elapsed = performance.now() - start
    // Guards against the old one-second watchdog floor; 500 ms leaves room for a busy machine (#99).
    if (fast.result?.output !== 'hi\n' || elapsed >= 500) throw new Error(`Fast exec failed: ${elapsed} ms`)
    console.log(`PASS: remote echo hi ${elapsed.toFixed(2)} ms`)
    const originalResult = service.result.bind(service)
    let withheld = false
    service.result = (computer, id, result, final) => {
      if (final && result.output === 'SIDE_EFFECT\n' && !withheld) {
        withheld = true
        return
      }
      originalResult(computer, id, result, final)
    }
    await service.submit('bot', { computer: identity.id, requestId: 'cancel-race', background: true, operation: { kind: 'exec', command: 'echo SIDE_EFFECT' } })
    await eventually(async () => withheld)
    service.cancel('bot', { computer: identity.id, requestId: 'cancel-race' })
    await eventually(async () => service.read('bot', { computer: identity.id, requestId: 'cancel-race' }).status === 'cancel_acked')
    if (service.read('bot', { computer: identity.id, requestId: 'cancel-race' }).result?.output !== 'SIDE_EFFECT\n') throw new Error('Late cancellation lost the stored outcome')
    console.log('PASS: cancellation racing a finished helper preserves the actual result')
    const done = join(root, 'survived')
    const pidFile = join(root, 'restart-pid')
    await service.submit('bot', {
      computer: identity.id,
      requestId: 'restart',
      background: true,
      operation: { kind: 'exec', command: `echo $$ > '${pidFile}'; sleep 2; echo SURVIVED > '${done}'` }
    })
    await eventually(async () => existsSync(pidFile))
    service.close()
    door.stop(true)
    service = makeService()
    door = startPublicDoor(service, port)
    await eventually(async () => service.list().some(c => c.id === identity.id && c.online))
    await eventually(async () => service.read('bot', { computer: identity.id, requestId: 'restart' }).status === 'completed')
    if (!existsSync(done)) throw new Error('Restart aborted remote work')
    const revokePid = join(root, 'revoke-pid')
    await service.submit('bot', { computer: identity.id, requestId: 'revoke', background: true, operation: { kind: 'exec', command: `echo $$ > '${revokePid}'; exec sleep 120` } })
    await eventually(async () => existsSync(revokePid))
    const pid = Number(readFileSync(revokePid, 'utf8'))
    service.remove(identity.id)
    await eventually(async () => {
      try {
        process.kill(pid, 0)
        return false
      } catch {
        return true
      }
    })
    console.log('PASS: server restart (including unsigned 1008) preserved remote work; signed revocation terminated it')
  } finally {
    clearInterval(tick)
    helper.kill()
    await helper.exited
    service.close()
    door.stop(true)
    db.close()
  }
}
