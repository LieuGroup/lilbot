import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import { z } from 'zod'
import { ComputerHello } from '../../shared/computer-schema'
import type { ComputerStore } from './computer-store'
import type { ServerKey } from './server-key'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const Registration = z.object({ code: z.string().max(200), publicKey: z.string().max(1000), hello: ComputerHello, signature: z.string().max(200) })
export class ComputerAuth {
  constructor(
    private store: ComputerStore,
    readonly serverKey: ServerKey
  ) {}
  code(name: string) {
    name = z.string().trim().min(1).max(100).parse(name)
    const code = `${randomBytes(24).toString('base64url')}.${this.serverKey.fingerprint}`
    const expiresAt = Date.now() + 10 * 60_000
    this.store.db.query('DELETE FROM computer_codes WHERE expires_at < ?').run(Date.now())
    this.store.db.query('INSERT INTO computer_codes VALUES(?,?,?)').run(hash(code), expiresAt, name)
    return { code, expiresAt }
  }
  register(input: z.infer<typeof Registration>) {
    const code = this.store.db.query('SELECT name FROM computer_codes WHERE hash=? AND expires_at>?').get(hash(input.code), Date.now()) as { name: string } | null
    if (!code) throw new Error('Invalid registration.')
    const key = createPublicKey(input.publicKey)
    if (
      key.asymmetricKeyType !== 'ed25519' ||
      !verify(null, Buffer.from(JSON.stringify({ code: input.code, publicKey: input.publicKey, hello: input.hello })), key, Buffer.from(input.signature, 'base64'))
    )
      throw new Error('Invalid registration.')
    const hello = ComputerHello.parse(input.hello)
    return this.store.db.transaction(() => {
      const used = this.store.db.query('DELETE FROM computer_codes WHERE hash=? AND expires_at>? RETURNING hash').get(hash(input.code), Date.now())
      if (!used) throw new Error('Invalid registration.')
      const id = crypto.randomUUID()
      this.store.add(id, { ...hello, name: code.name }, input.publicKey)
      return { id }
    })()
  }
  authenticate(request: Request) {
    const id = request.headers.get('x-lilbot-computer') ?? ''
    const timestamp = request.headers.get('x-lilbot-time') ?? ''
    const nonce = request.headers.get('x-lilbot-nonce') ?? ''
    const signature = request.headers.get('x-lilbot-signature') ?? ''
    const key = this.store.key(id)
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
