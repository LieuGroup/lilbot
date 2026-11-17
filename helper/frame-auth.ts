import { createHash, createHmac, sign, verify } from 'node:crypto'

export const codeId = (code: string) => createHash('sha256').update(`lilbot-install-id:${code}`).digest('hex')
export const codeKey = (code: string) => createHash('sha256').update(code).digest('hex')
export const registrationMac = (key: string, publicKey: string, hello: unknown) => createHmac('sha256', key).update(JSON.stringify({ publicKey, hello })).digest('hex')
const message = (id: string, nonce: string, sequence: number, payload: string) =>
  Buffer.from(JSON.stringify(['lilbot-helper-frame-v1', id, nonce, sequence, createHash('sha256').update(payload).digest('hex')]))
export function helperFrame(key: string, id: string, nonce: string, sequence: number, payload: string) {
  return JSON.stringify({ sequence, payload, signature: sign(null, message(id, nonce, sequence, payload), key).toString('base64') })
}
export function verifyHelperFrame(key: string, id: string, nonce: string, sequence: number, frame: { sequence: number; payload: string; signature: string }) {
  return frame.sequence === sequence && typeof frame.payload === 'string' && verify(null, message(id, nonce, sequence, frame.payload), key, Buffer.from(frame.signature, 'base64'))
}
