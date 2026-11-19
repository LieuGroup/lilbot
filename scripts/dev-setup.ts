/** Provision only the development engine; never installs or edits a LilBot/production unit. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertDevelopmentTarget, canonicalPath, developmentHome } from '../server/environment'

const unitName = 'lilbot-dev-hermes.service'
assertDevelopmentTarget(process.env)
const home = join(developmentHome, 'hermes')
const locks = join(developmentHome, 'hermes-locks')
for (const path of [developmentHome, home, locks, ...['data', 'workspaces', 'skills'].map(p => join(developmentHome, p))]) {
  if (canonicalPath(path) !== path) throw new Error('Dev setup refuses symlinked directories')
  mkdirSync(path, { recursive: true, mode: 0o700 })
}
const credential = join(home, '.env')
const config = join(home, 'config.yaml')
if (canonicalPath(credential) !== credential || canonicalPath(config) !== config) throw new Error('Dev setup refuses symlinked config or credentials')
// Read only the provider's allowlisted configuration. Never copy the complete config or .env.
const source = Bun.YAML.parse(readFileSync(join(homedir(), '.hermes/config.yaml'), 'utf8')) as any
const provider = source.providers?.cliproxyapi
if (!provider || typeof provider.key_env !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(provider.key_env)) throw new Error('CLIProxy provider needs a key_env reference')
const keyName: string = provider.key_env
if (!existsSync(credential)) {
  const line = readFileSync(join(homedir(), '.hermes/.env'), 'utf8')
    .split('\n')
    .find(line => line.startsWith(`${keyName}=`))
  if (!line) throw new Error('CLIProxy client key variable is missing')
  // The installed proxy is remote; no local key-issuing configuration is available.
  writeFileSync(credential, `${line}\n`, { mode: 0o600, flag: 'wx' })
}
const credentials = readFileSync(credential, 'utf8').trim().split('\n')
if (credentials.length !== 1 || !credentials[0].startsWith(`${keyName}=`)) throw new Error('Dev .env must contain only the CLIProxy key variable')
chmodSync(credential, 0o600)
if (!existsSync(config)) {
  const ownProvider = Object.fromEntries(['name', 'base_url', 'key_env', 'transport', 'discover_models', 'models'].filter(k => k in provider).map(k => [k, provider[k]]))
  writeFileSync(
    config,
    Bun.YAML.stringify(
      {
        _config_version: 12,
        model: { default: 'anthropic/claude-sonnet-5-5', provider: 'cliproxyapi', base_url: provider.base_url, key_env: keyName, api_mode: provider.transport },
        providers: { cliproxyapi: ownProvider },
        webapp: { enabled: false },
        approvals: { mode: 'off' }
      },
      null,
      2
    ),
    { mode: 0o600, flag: 'wx' }
  )
}
const binary = Bun.which(process.env.LILBOT_HERMES_BIN ?? 'hermes')
if (!binary) throw new Error('Install Hermes or set LILBOT_HERMES_BIN')
const quote = (value: string) => `"${value.replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const unit = `[Unit]
Description=LilBot development Hermes gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=${developmentHome.replaceAll('%', '%%')}
Environment=${quote(`HERMES_HOME=${home}`)}
Environment=${quote(`HERMES_GATEWAY_LOCK_DIR=${locks}`)}
EnvironmentFile=${credential.replaceAll('%', '%%')}
ExecStart=${quote(resolve(binary))} gateway run
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
`
const unitDir = join(homedir(), '.config/systemd/user')
mkdirSync(unitDir, { recursive: true })
const unitPath = join(unitDir, unitName)
if (canonicalPath(unitPath) !== unitPath) throw new Error('Dev setup refuses a symlinked unit')
const changed = !existsSync(unitPath) || readFileSync(unitPath, 'utf8') !== unit
if (changed) writeFileSync(unitPath, unit)
async function systemctl(...args: string[]) {
  const child = Bun.spawn(['systemctl', '--user', ...args], { stdout: 'ignore', stderr: 'inherit' })
  if (await child.exited) throw new Error(`systemctl ${args[0]} failed`)
}
if (changed) await systemctl('daemon-reload')
await systemctl(changed ? 'restart' : 'start', unitName)
// Active only means systemd spawned it; first-use dependency setup can still be running.
let ready = false
for (const deadline = Date.now() + 180_000; Date.now() < deadline; ) {
  const probe = Bun.spawn([binary, 'gateway', 'attach', '--json'], {
    env: { ...process.env, HERMES_HOME: home, HERMES_GATEWAY_LOCK_DIR: locks },
    stdout: 'pipe',
    stderr: 'ignore'
  })
  const result = await new Response(probe.stdout).text()
  if ((await probe.exited) === 0) {
    try {
      const receipt = JSON.parse(result)
      ready = receipt.state === 'ready' && receipt.endpoint?.profile_id === home
    } catch {
      /* not ready */
    }
  }
  if (ready) break
  await Bun.sleep(1000)
}
if (!ready) throw new Error('Development gateway did not become ready; inspect lilbot-dev-hermes.service')
console.log(`Development gateway started: ${unitName}\nHome: ${home}\nCredentials: ${credential} (0600; CLIProxy variable only)`)
