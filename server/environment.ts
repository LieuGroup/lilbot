/** Fail before opening stores, listeners or engine connections. */
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

type Env = Record<string, string | undefined>
export const developmentHome = join(homedir(), 'lilbot-dev')

/** Resolve existing ancestors too, so a missing child below a symlink cannot bypass the guard. */
export function canonicalPath(path: string): string {
  const full = resolve(path.replace(/^~(?=\/|$)/, homedir()))
  if (existsSync(full)) return realpathSync(full)
  const parent = dirname(full)
  return parent === full ? full : join(canonicalPath(parent), full.slice(parent.length + 1))
}
function inside(path: string, root: string) {
  const value = canonicalPath(path)
  const base = canonicalPath(root)
  return value === base || value.startsWith(`${base}/`)
}
export function assertDevelopmentTarget(env: Env) {
  if (env.LILBOT_ENV === 'production') throw new Error('Development refuses LILBOT_ENV=production')
  for (const key of ['LILBOT_PORT', 'LILBOT_CHECK_PORT', 'LILBOT_PUBLIC_PORT', 'LILBOT_ACCESS_PORT']) {
    if (env[key] && [3370, 3372, 3373].includes(Number(env[key]))) throw new Error(`Development refuses production port: ${key}`)
  }
  const protectedPaths: Record<string, string> = {
    LILBOT_DATA_DIR: join(homedir(), '.local/share/lilbot'),
    LILBOT_WORKSPACES_DIR: join(homedir(), 'lilbot/workspaces'),
    LILBOT_SKILLS_DIR: join(homedir(), 'lilbot/skills'),
    HERMES_HOME: join(homedir(), '.hermes')
  }
  for (const [key, path] of Object.entries(protectedPaths)) {
    if (env[key] && inside(env[key]!, path)) throw new Error(`Development refuses production path: ${key}`)
  }
  for (const [key, value] of Object.entries(env)) {
    if (/LILBOT.*(SERVICE|UNIT)/.test(key) && value?.replace(/\.service$/, '') === 'lilbot') throw new Error('Development refuses lilbot.service')
  }
}
export function assertServerEnvironment(env: Env) {
  if (!env.LILBOT_ENV) throw new Error('Set LILBOT_ENV explicitly; use the development launcher for checks')
  if (!['production', 'development'].includes(env.LILBOT_ENV)) throw new Error('Invalid LILBOT_ENV')
  if (env.LILBOT_ENV !== 'development') {
    const testSetting = Object.keys(env).find(
      key => env[key] !== undefined && (/^LILBOT_.*(?:TEST|CHECK|DEV)_/.test(key) || ['LILBOT_BOT_IDS', 'LILBOT_SKIP_MEMORY_SETUP', 'LILBOT_LIVE_MODEL'].includes(key))
    )
    if (testSetting) throw new Error(`Production refuses test-only setting: ${testSetting}`)
    return
  }
  assertDevelopmentTarget(env)
  for (const key of ['HERMES_HOME', 'HERMES_GATEWAY_LOCK_DIR', 'LILBOT_DATA_DIR', 'LILBOT_WORKSPACES_DIR', 'LILBOT_SKILLS_DIR']) {
    if (!env[key] || !inside(env[key]!, developmentHome)) throw new Error(`Development requires ${key} under ${developmentHome}`)
  }
  if (!env.LILBOT_PORT || !Number.isInteger(Number(env.LILBOT_PORT)) || Number(env.LILBOT_PORT) < 1) throw new Error('Development requires its own port')
}
