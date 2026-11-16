import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, closeSync, constants, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { challenge, fingerprint, frameMessage } from '../../helper/server-trust'

export class ServerKey {
  readonly publicKey: string
  readonly fingerprint: string
  constructor(private privateKey: string) {
    this.publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()
    this.fingerprint = fingerprint(this.publicKey)
  }
  frame(id: string, nonce: string, sequence: number, payload: string) {
    return JSON.stringify({ sequence, payload, signature: sign(null, frameMessage(id, nonce, sequence, payload), this.privateKey).toString('base64') })
  }
  proof(id: string, nonce: string) {
    return { type: 'server', publicKey: this.publicKey, signature: sign(null, challenge(id, nonce), this.privateKey).toString('base64') }
  }
}
export function loadServerKey(directory: string) {
  const path = join(directory, 'computer-server-key.pem')
  try {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try {
      writeFileSync(fd, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }))
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  chmodSync(path, 0o600)
  return new ServerKey(readFileSync(path, 'utf8'))
}
