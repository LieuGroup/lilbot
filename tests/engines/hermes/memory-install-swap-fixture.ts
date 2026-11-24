import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MODULE_DIR = join(import.meta.dir, '../../../server/engines/hermes')
export const CURRENT_VERSION = /^version:\s*(\S+)/m.exec(readFileSync(join(MODULE_DIR, 'memory-adapter/plugin.yaml'), 'utf8'))![1]
export const CURRENT_NAME = `lilbot-memory-v${CURRENT_VERSION.replaceAll('.', '-')}`
export const OLD_NAME = 'lilbot-memory-v0-14-0'

/** Fake `hermes` CLI that applies `config set` to `config.yaml`, checks the active-provider folder invariant
 *  before and after every write, logs keys, and supports fault injection and cross-process barriers via env vars. */
export function writeFakeHermes(root: string, logFile: string): string {
  const bin = join(root, 'fake-hermes')
  writeFileSync(
    bin,
    `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
const pIdx = args.indexOf('-p')
const profile = pIdx >= 0 ? args[pIdx + 1] : 'default'
const key = args[args.length - 2]
const raw = args[args.length - 1]
const home = profile === 'default' ? process.env.HERMES_HOME! : join(process.env.HERMES_HOME!, 'profiles', profile)
const cfgPath = join(home, 'config.yaml')
const readDoc = (): Record<string, any> => (existsSync(cfgPath) ? ((Bun.YAML.parse(readFileSync(cfgPath, 'utf8')) as any) ?? {}) : {})
const assertInvariant = (stage: string) => {
  const p = readDoc()?.memory?.provider
  if (typeof p === 'string' && p.length > 0 && !existsSync(join(home, 'plugins', p, 'plugin.yaml'))) {
    console.error('INVARIANT BROKEN (' + stage + '): memory.provider=' + p + ' folder missing')
    process.exit(99)
  }
}
assertInvariant('before:' + key)
appendFileSync('${logFile}', key + '\\n')
if (process.env.SIGNAL_ON_KEY === key && process.env.SIGNAL_FILE) writeFileSync(process.env.SIGNAL_FILE, 'ready')
if (process.env.WAIT_ON_KEY === key && process.env.WAIT_FILE) {
  for (let i = 0; i < 400 && !existsSync(process.env.WAIT_FILE); i++) await Bun.sleep(10)
}
if (process.env.FAIL_BEFORE_KEY === key) { console.error('injected fail before ' + key); process.exit(2) }
const doc = readDoc()
let val: unknown = raw
try { val = JSON.parse(raw) } catch {}
const parts = key.split('.')
let cur = doc
for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] = typeof cur[parts[i]] === 'object' && cur[parts[i]] ? cur[parts[i]] : {}
cur[parts.at(-1)!] = val
writeFileSync(cfgPath, JSON.stringify(doc, null, 2))
assertInvariant('after:' + key)
if (process.env.FLIP_AFTER_KEY === key && process.env.FLIP_TO_PROVIDER) {
  doc.memory.provider = process.env.FLIP_TO_PROVIDER
  writeFileSync(cfgPath, JSON.stringify(doc, null, 2))
}
if (process.env.FAIL_AFTER_KEY === key) { console.error('injected fail after ' + key); process.exit(3) }
`,
    { mode: 0o755 }
  )
  return bin
}

export function seedProfile(root: string, profile = 'owned', provider = OLD_NAME, acp: string[] = ['custom_plugin']) {
  const home = join(root, 'profiles', profile)
  mkdirSync(join(home, 'plugins', provider), { recursive: true })
  writeFileSync(join(home, 'plugins', provider, 'plugin.yaml'), `name: ${provider}\nversion: 0.14.0\n`)
  writeFileSync(join(home, 'lilbot-memory.json'), JSON.stringify({ url: 'http://127.0.0.1:1', checkpoint_key: 'ckpt-bot-a', bot_id: 'bot-a' }))
  writeFileSync(join(home, 'config.yaml'), JSON.stringify({ memory: { provider }, compression: { checkpoint_required: true }, known_plugin_toolsets: { acp } }, null, 2))
  return { home, checkpointKey: 'ckpt-bot-a' }
}

export function readState(home: string) {
  const doc = Bun.YAML.parse(readFileSync(join(home, 'config.yaml'), 'utf8')) as {
    memory?: { provider?: string }
    known_plugin_toolsets?: { acp?: string[] }
  }
  const provider = doc?.memory?.provider ?? ''
  const folders = existsSync(join(home, 'plugins')) ? readdirSync(join(home, 'plugins')).sort() : []
  const providerExists = provider.length > 0 && existsSync(join(home, 'plugins', provider, 'plugin.yaml'))
  return { provider, acp: doc?.known_plugin_toolsets?.acp ?? [], folders, providerExists }
}

export async function runSnippet(root: string, hermes: string, code: string, extraEnv: Record<string, string> = {}) {
  const script = join(root, `run-${crypto.randomUUID()}.ts`)
  writeFileSync(script, code)
  const child = Bun.spawn(['bun', script], {
    env: { ...process.env, HERMES_HOME: root, LILBOT_HERMES_BIN: hermes, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { stdout, stderr, exitCode }
}
