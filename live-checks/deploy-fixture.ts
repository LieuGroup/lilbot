/** Isolated systemd fixture. All writes are confined to this root and these two unit names. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { devScratch } from '../scripts/dev-paths'
import { openDatabase } from '../server/database/database'
import type { Deployment } from '../server/deploy/deploy-state'
import { readJson } from '../server/deploy/files'
import { command, git, systemctl } from '../server/deploy/process'

export class DeployFixture {
  root = ''
  checkout = ''
  data = ''
  releases = ''
  link = ''
  unit = `lilbot-deploy-check-${crypto.randomUUID()}.service`
  watchdog = `lilbot-watchdog-check-${crypto.randomUUID()}.service`
  port = 0
  env: Record<string, string | undefined> = {}
  async setup() {
    this.root = devScratch('lilbot-deploy')
    this.checkout = join(this.root, 'repo')
    this.data = join(this.root, 'data')
    await mkdir(this.data)
    openDatabase(join(this.data, 'lilbot.db')).close()
    this.releases = join(this.root, 'releases')
    this.link = join(this.root, 'release')
    // A clone, never a shell-created worktree. Nothing is changed in the source checkout.
    await command(['git', 'clone', '--no-hardlinks', process.cwd(), this.checkout])
    await git(this.checkout, 'config', 'user.name', 'Deploy check')
    await git(this.checkout, 'config', 'user.email', 'deploy-check@example.invalid')
    await command([process.execPath, 'install', '--frozen-lockfile'], this.checkout)
    const listener = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') })
    this.port = listener.port!
    listener.stop(true)
    this.env = {
      ...process.env,
      LILBOT_DATA_DIR: this.data,
      LILBOT_RELEASES_DIR: this.releases,
      LILBOT_RELEASE_LINK: this.link,
      LILBOT_DEPLOY_UNIT: this.unit,
      LILBOT_DEPLOY_WATCHDOG_UNIT: this.watchdog,
      LILBOT_DEPLOY_HEALTH_URL: `http://127.0.0.1:${this.port}/api/health`
    }
    const units = join(homedir(), '.config/systemd/user')
    const quote = (s: string) => `"${s.replaceAll('%', '%%').replaceAll('"', '\\"')}"`
    await writeFile(
      join(units, this.unit),
      `[Service]\nWorkingDirectory=${this.link.replaceAll('%', '%%')}\nExecStart=${quote(process.execPath)} ${quote(join(this.link, 'server/main.ts'))}\nEnvironment=LILBOT_ENV=development\nEnvironment=HERMES_HOME=${quote(process.env.HERMES_HOME!)}\nEnvironment=HERMES_GATEWAY_LOCK_DIR=${quote(process.env.HERMES_GATEWAY_LOCK_DIR!)}\nEnvironment=LILBOT_PORT=${this.port}\nEnvironment=LILBOT_DATA_DIR=${quote(this.data)}\nEnvironment=LILBOT_WORKSPACES_DIR=${quote(join(this.root, 'workspaces'))}\nEnvironment=LILBOT_SKILLS_DIR=${quote(join(this.root, 'skills'))}\nEnvironment=LILBOT_BOT_IDS=dev-deploy-check-unmatched-${crypto.randomUUID()}\nEnvironment=LILBOT_SKIP_MEMORY_SETUP=1\nEnvironment=LILBOT_REVIEW=off\nEnvironment=LILBOT_PUBLIC_ENABLED=0\nRestart=always\nRestartSec=1\n`
    )
    await writeFile(
      join(units, this.watchdog),
      `[Service]\nType=oneshot\nExecStart=${quote(process.execPath)} ${quote(join(this.data, 'deploy/runner/watchdog.ts'))} ${quote(join(this.data, 'deploy/job.json'))}\nTimeoutStartSec=8min\nRestart=no\nUMask=0077\n`
    )
    await systemctl('daemon-reload')
  }
  private async run(args: string[], timeout: number) {
    return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: this.checkout, env: this.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      const collect = (data: Buffer) => {
        output = (output + data).slice(-12_000)
      }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      // Kill the whole isolated command group: no orphan verifier/helper can keep pipes open.
      const timer = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {}
        }
      }, timeout)
      child.on('error', error => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', code => {
        clearTimeout(timer)
        resolve({ code, output })
      })
    })
  }
  async verify() {
    const { code, output } = await this.run(['run', 'verify'], 600_000)
    assert.equal(code, 0, `Isolated verification failed:\n${output}`)
  }
  async commit(message: string) {
    await command([process.execPath, 'run', 'format'], this.checkout)
    await git(this.checkout, 'add', '.')
    await git(this.checkout, 'commit', '-m', message)
    return git(this.checkout, 'rev-parse', 'HEAD')
  }
  async refuse(reason: string) {
    const { code, output } = await this.run(['run', 'deploy'], 30_000)
    assert.equal(code, 1)
    assert.ok(output.includes(reason), `Expected refusal: ${reason}; received ${output}`)
  }
  async deploy(expectedCode: number, bootstrap = false) {
    const { code, output } = await this.run(['run', 'deploy', ...(bootstrap ? ['--bootstrap'] : [])], 420_000)
    assert.equal(code, expectedCode, `Unexpected deploy result:\n${output}`)
    // The watchdog releases its lock just after persisting the outcome.
    for (let n = 0; n < 100; n++) {
      const active = await systemctl('show', this.watchdog, '-p', 'ActiveState', '--value')
      if (active !== 'activating' && active !== 'active') break
      await Bun.sleep(100)
    }
    return readJson<Deployment>(join(this.data, 'deploy/job.json'))
  }
  async edit(path: string, text: string) {
    await writeFile(join(this.checkout, path), text)
  }
  async read(path: string) {
    return readFile(join(this.checkout, path), 'utf8')
  }
  async cleanup() {
    for (const unit of [this.watchdog, this.unit]) {
      await systemctl('stop', unit).catch(() => {})
      await rm(join(homedir(), '.config/systemd/user', unit), { force: true })
      await systemctl('reset-failed', unit).catch(() => {})
    }
    await systemctl('daemon-reload')
    if (this.root) await rm(this.root, { recursive: true, force: true })
  }
}
