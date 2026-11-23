import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname, platform } from 'node:os'
import { join } from 'node:path'
import { codeId, codeKey, registrationMac } from './frame-auth'
import { detectWorkerAgents } from './worker-driver'

export const configDir = process.env.LILBOT_HELPER_CONFIG_DIR || join(homedir(), '.config', 'lilbot-helper')
export interface Identity {
  url: string
  id: string
  serverFingerprint: string
  privateKey: string
}
export function loadIdentity(): Identity {
  return JSON.parse(readFileSync(join(configDir, 'identity.json'), 'utf8'))
}
function validateUrl(raw: string) {
  const url = new URL(raw)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
  )
    throw new Error('Use an HTTPS origin (HTTP only for local testing).')
  return url.origin
}
export async function register(url: string, code: string) {
  url = validateUrl(url)
  const serverFingerprint = code.split('.')[1]
  if (!/^[a-f0-9]{64}$/.test(serverFingerprint ?? '')) throw new Error('Install code must include the server fingerprint.')
  const pair = generateKeyPairSync('ed25519')
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const workerAgents = await detectWorkerAgents()
  const hasRunnableWorker = workerAgents.some(a => a.supported !== false)
  const capabilities = ['exec', 'read', 'write', 'list', 'copy', ...(hasRunnableWorker ? ['worker'] : [])]
  const hello = { name: hostname(), os: platform(), home: homedir(), capabilities, ...(workerAgents.length ? { workerAgents } : {}) }
  const body = { codeId: codeId(code), mac: '', publicKey, hello }
  body.mac = registrationMac(codeKey(code), publicKey, body.hello)
  const signature = sign(null, Buffer.from(JSON.stringify(body)), privateKey).toString('base64')
  const response = await fetch(`${url}/helper/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, signature }),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error'
  })
  if (!response.ok) throw new Error('Registration refused. Get a new install code from LilBot.')
  const { id } = (await response.json()) as { id: string }
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  chmodSync(configDir, 0o700)
  writeFileSync(join(configDir, 'identity.json'), JSON.stringify({ url, id, privateKey, serverFingerprint }), {
    mode: 0o600,
    flag: 'wx'
  })
}
export function connectionHeaders(identity: Identity) {
  const timestamp = String(Date.now())
  const nonce = randomBytes(24).toString('base64url')
  const signature = sign(null, Buffer.from(`GET\n/helper/connect\n${identity.id}\n${timestamp}\n${nonce}`), identity.privateKey).toString('base64')
  return { 'x-lilbot-computer': identity.id, 'x-lilbot-time': timestamp, 'x-lilbot-nonce': nonce, 'x-lilbot-signature': signature }
}
