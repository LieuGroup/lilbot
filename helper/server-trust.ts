/** Both sides sign exactly this connection challenge; the install code pins its public key. */
import { createHash, createPublicKey, verify } from 'node:crypto'

export const fingerprint = (key: string) =>
  createHash('sha256')
    .update(createPublicKey(key).export({ type: 'spki', format: 'der' }))
    .digest('hex')
export const challenge = (id: string, nonce: string) => Buffer.from(`lilbot-server-v1\n${id}\n${nonce}`)
export function verifyServer(pin: string, id: string, nonce: string, frame: { publicKey: string; signature: string }) {
  try {
    return fingerprint(frame.publicKey) === pin && verify(null, challenge(id, nonce), frame.publicKey, Buffer.from(frame.signature, 'base64'))
  } catch {
    return false
  }
}

export const frameMessage = (id: string, nonce: string, sequence: number, payload: string) => Buffer.from(JSON.stringify(['lilbot-frame-v1', id, nonce, sequence, payload]))
export function verifyFrame(publicKey: string, id: string, nonce: string, sequence: number, frame: { sequence: number; payload: string; signature: string }) {
  try {
    return (
      frame.sequence === sequence &&
      typeof frame.payload === 'string' &&
      verify(null, frameMessage(id, nonce, sequence, frame.payload), publicKey, Buffer.from(frame.signature, 'base64'))
    )
  } catch {
    return false
  }
}
