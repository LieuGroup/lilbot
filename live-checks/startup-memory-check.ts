import { devScratch } from '../scripts/dev-env'
import { deleteProfile } from './check-process'
import { devPort } from '../scripts/dev-paths'
/** Real isolated-server regression for #29. Only creates/edits/deletes temporary profiles. */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { BotStore } from '../server/bots/bot-store'
import { openDatabase } from '../server/database/database'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { installMemory, MEMORY_ADAPTER_VERSION } from '../server/engines/hermes/hermes-memory-setup'
import { engineToken } from '../server/http/engine-api'

const root = devScratch('lilbot-startup')
const db = openDatabase(join(root, 'lilbot.db'))
const engine = new HermesEngine()
const ids: string[] = []
let server: ReturnType<typeof Bun.spawn> | undefined
const identity = {
  id: '',
  name: 'Temporary startup check',
  function: 'Temporary startup isolation check',
  instructions: 'Reply briefly.',
  model: null,
  reasoningEffort: null,
  permissionMode: 'full-access' as const,
  isDefault: false
}
const profile = (id: string) => join(process.env.HERMES_HOME!, 'profiles', id)
function digest(path: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const file of readdirSync(path, { recursive: true, withFileTypes: true })
    .filter(file => file.isFile())
    .map(file => join(file.parentPath, file.name))
    .sort()) {
    const name = relative(path, file)
    // Hermes maintains logs and runtime databases independently of adapter setup.
    if (name === 'config.yaml' || name === 'lilbot-memory.json' || name.startsWith('plugins/') || name.startsWith('memories/')) {
      files[name] = createHash('sha256').update(readFileSync(file)).digest('hex')
    }
  }
  return files
}
async function config(id: string, value: string) {
  const child = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', '-p', id, 'config', 'set', 'memory.provider', value], { env: process.env, stdout: 'ignore', stderr: 'pipe' })
  if ((await child.exited) !== 0) throw new Error('Could not set temporary provider')
}
try {
  // Reserve a free port, then start the real server on it.
  const port = devPort()
  engineToken(root)
  for (let i = 0; i < 2; i++) {
    const id = await engine.createRuntime(identity)
    ids.push(id)
    await installMemory(id, { url: `http://127.0.0.1:${port}`, tokenFile: join(root, 'engine-token'), botId: i === 0 ? 'owned-app' : 'unbound-app' })
    renameSync(join(profile(id), 'plugins', `lilbot-memory-v${MEMORY_ADAPTER_VERSION.replaceAll('.', '-')}`), join(profile(id), 'plugins', 'lilbot-memory-v0-1-0'))
    await config(id, 'lilbot-memory-v0-1-0')
  }
  new BotStore(db).import('hermes', [{ ...identity, id: 'owned-app', engineId: 'hermes', engineBotId: ids[0], isDefault: false }])
  const before = digest(profile(ids[1]))
  server = Bun.spawn(['bun', 'server/main.ts'], {
    cwd: join(import.meta.dir, '..'),
    env: {
      ...process.env,
      LILBOT_PORT: String(port),
      LILBOT_DATA_DIR: root,
      LILBOT_SKILLS_DIR: join(root, 'skills'),
      LILBOT_WORKSPACES_DIR: join(root, 'workspaces'),
      LILBOT_BOT_IDS: ids.join(','),
      LILBOT_SKIP_MEMORY_SETUP: '0',
      LILBOT_REVIEW: 'off'
    },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader()
  let output = ''
  await Promise.race([
    (async () => {
      while (!output.includes(`Memory adapter updated to ${MEMORY_ADAPTER_VERSION} for: ${ids[0]}`)) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('Server exited before refresh completed')
        output += new TextDecoder().decode(chunk.value)
      }
    })(),
    Bun.sleep(45_000).then(() => {
      throw new Error('Startup refresh timed out')
    })
  ])
  const after = digest(profile(ids[1]))
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name])
  if (changed.length) throw new Error(`Unbound profile changed: ${changed.join(', ')}`)
  console.log('PASS: real startup upgraded the bound native profile and left the unbound adapter, configuration and memories unchanged.')
} finally {
  if (server) {
    server.kill()
    await server.exited
  }
  for (const id of ids) {
    const child = deleteProfile(id, 'pipe')
    if ((await child.exited) !== 0) {
      console.error(`Cleanup failed for temporary profile ${id}`)
      process.exitCode = 1
    }
  }
  db.close()
  rmSync(root, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
