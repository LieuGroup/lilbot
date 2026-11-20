import { createPublicKey, type KeyObject, randomBytes, timingSafeEqual, verify } from 'node:crypto'
import { z } from 'zod'
import { codeId, codeKey, registrationMac } from '../../helper/frame-auth'
import { ComputerHello } from '../../shared/computer-schema'
import type { ComputerStore } from './computer-store'
import type { ServerKey } from './server-key'

export const Registration = z.object({
  codeId: z.string().length(64),
  mac: z.string().length(64),
  publicKey: z.string().max(1000),
  hello: ComputerHello,
  signature: z.string().max(200)
})
export class ComputerAuth {
  private keys = new Map<string, { pem: string; key: KeyObject }>()
  publicKey(id: string) {
    const pem = this.store.key(id)
    if (!pem) {
      this.keys.delete(id)
      return null
    }
    const cached = this.keys.get(id)
    if (cached?.pem === pem) return cached.key
    const key = createPublicKey(pem)
    this.keys.set(id, { pem, key })
    return key
  }
  constructor(
    private store: ComputerStore,
    readonly serverKey: ServerKey
  ) {}
  /** Told when a computer registers: its id, and the device its "Add this computer" attempt started on, if any. */
  registered: (computer: string, device: string | null) => void = () => {}
  code(name: string) {
    name = z.string().trim().min(1).max(100).parse(name)
    const code = `${randomBytes(24).toString('base64url')}.${this.serverKey.fingerprint}`
    const expiresAt = Date.now() + 10 * 60_000
    this.store.db.query('DELETE FROM computer_codes WHERE expires_at < ?').run(Date.now())
    this.store.db.query('INSERT INTO computer_codes VALUES(?,?,?,?)').run(codeId(code), codeKey(code), expiresAt, name)
    return { code, expiresAt }
  }
  register(input: z.infer<typeof Registration>) {
    const code = this.store.db.query('SELECT name,secret FROM computer_codes WHERE hash=? AND expires_at>?').get(input.codeId, Date.now()) as {
      name: string
      secret: string
    } | null
    if (!code || !timingSafeEqual(Buffer.from(registrationMac(code.secret, input.publicKey, input.hello)), Buffer.from(input.mac))) throw new Error('Invalid registration.')
    const key = createPublicKey(input.publicKey)
    if (
      key.asymmetricKeyType !== 'ed25519' ||
      !verify(
        null,
        Buffer.from(JSON.stringify({ codeId: input.codeId, mac: input.mac, publicKey: input.publicKey, hello: input.hello })),
        key,
        Buffer.from(input.signature, 'base64')
      )
    )
      throw new Error('Invalid registration.')
    const hello = ComputerHello.parse(input.hello)
    const { id, device } = this.store.db.transaction(() => {
      const used = this.store.db.query('DELETE FROM computer_codes WHERE hash=? AND expires_at>? RETURNING hash').get(input.codeId, Date.now())
      if (!used) throw new Error('Invalid registration.')
      const id = crypto.randomUUID()
      this.store.add(id, { ...hello, name: code.name }, input.publicKey)
      this.store.db.query('UPDATE computer_attempts SET computer_id=? WHERE code_id=?').run(id, input.codeId)
      const attempt = this.store.db.query('SELECT device_id FROM computer_attempt_devices WHERE code_id=?').get(input.codeId) as { device_id: string } | null
      return { id, device: attempt?.device_id ?? null }
    })()
    this.registered(id, device)
    return { id }
  }
  authenticate(request: Request) {
    const id = request.headers.get('x-lilbot-computer') ?? ''
    const timestamp = request.headers.get('x-lilbot-time') ?? ''
    const nonce = request.headers.get('x-lilbot-nonce') ?? ''
    const signature = request.headers.get('x-lilbot-signature') ?? ''
    const key = this.publicKey(id)
    if (!key || !/^[\w-]{16,100}$/.test(nonce) || !/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60_000) return null
    const message = `${request.method}\n${new URL(request.url).pathname}\n${id}\n${timestamp}\n${nonce}`
    try {
      if (!verify(null, Buffer.from(message), key, Buffer.from(signature, 'base64'))) return null
      this.store.db.query('DELETE FROM computer_nonces WHERE expires_at < ?').run(Date.now())
      this.store.db.query('INSERT INTO computer_nonces VALUES(?,?,?)').run(id, nonce, Date.now() + 120_000)
      return id
    } catch {
      return null
    }
  }
}
