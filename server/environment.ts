/** Fail before opening stores, listeners or engine connections. */
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { EngineEnvironmentRules } from './engines/engine-ops'
import { registeredEngineEnvironmentRules } from './engines/metadata'

type Env = Record<string, string | undefined>
export const developmentHome = join(homedir(), 'lilbot-dev')
const ENGINE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

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
function validateEngineRules(rules: readonly EngineEnvironmentRules[]): { protectedEntries: [string, string][]; requiredDevPathVars: string[] } {
  if (!Array.isArray(rules) || rules.length === 0) throw new Error('Environment guard requires at least one registered engine rule')
  const seen = new Set<string>()
  const protectedEntries: [string, string][] = []
  const requiredDevPathVars: string[] = []
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') throw new Error('Invalid engine environment rule')
    if (typeof rule.engineId !== 'string' || !ENGINE_ID.test(rule.engineId) || seen.has(rule.engineId)) throw new Error('Invalid engine environment rule id')
    seen.add(rule.engineId)
    if (typeof rule.protectedDevPaths !== 'function') throw new Error(`Invalid protectedDevPaths for engine rule: ${rule.engineId}`)
    const paths = rule.protectedDevPaths()
    if (!paths || typeof paths !== 'object' || Array.isArray(paths)) throw new Error(`Invalid protectedDevPaths map for engine rule: ${rule.engineId}`)
    for (const [key, path] of Object.entries(paths)) {
      if (typeof key !== 'string' || !key.trim() || typeof path !== 'string' || !path.trim()) {
        throw new Error(`Invalid protectedDevPaths entry for engine rule: ${rule.engineId}`)
      }
      protectedEntries.push([key, path])
    }
    if (!Array.isArray(rule.requiredDevPathVars)) throw new Error(`Invalid requiredDevPathVars for engine rule: ${rule.engineId}`)
    for (const key of rule.requiredDevPathVars) {
      if (typeof key !== 'string' || !key.trim()) throw new Error(`Invalid requiredDevPathVars entry for engine rule: ${rule.engineId}`)
      requiredDevPathVars.push(key)
    }
  }
  return { protectedEntries, requiredDevPathVars }
}
export function assertDevelopmentTarget(env: Env, rules: readonly EngineEnvironmentRules[] = registeredEngineEnvironmentRules()) {
  const validated = validateEngineRules(rules)
  if (env.LILBOT_ENV === 'production') throw new Error('Development refuses LILBOT_ENV=production')
  for (const key of ['LILBOT_PORT', 'LILBOT_CHECK_PORT', 'LILBOT_PUBLIC_PORT', 'LILBOT_ACCESS_PORT']) {
    if (env[key] && [3370, 3372, 3373].includes(Number(env[key]))) throw new Error(`Development refuses production port: ${key}`)
  }
  const protectedEntries: [string, string][] = [
    ['LILBOT_DATA_DIR', join(homedir(), '.local/share/lilbot')],
    ['LILBOT_WORKSPACES_DIR', join(homedir(), 'lilbot/workspaces')],
    ['LILBOT_SKILLS_DIR', join(homedir(), 'lilbot/skills')],
    ...validated.protectedEntries
  ]
  for (const [key, path] of protectedEntries) {
    if (env[key] && inside(env[key]!, path)) throw new Error(`Development refuses production path: ${key}`)
  }
  for (const [key, value] of Object.entries(env)) {
    if (/LILBOT.*(SERVICE|UNIT)/.test(key) && value?.replace(/\.service$/, '') === 'lilbot') throw new Error('Development refuses lilbot.service')
  }
}
export function assertServerEnvironment(env: Env, rules: readonly EngineEnvironmentRules[] = registeredEngineEnvironmentRules()) {
  const validated = validateEngineRules(rules)
  if (!env.LILBOT_ENV) throw new Error('Set LILBOT_ENV explicitly; use the development launcher for checks')
  if (!['production', 'development'].includes(env.LILBOT_ENV)) throw new Error('Invalid LILBOT_ENV')
  if (env.LILBOT_ENV !== 'development') {
    const testSetting = Object.keys(env).find(
      key => env[key] !== undefined && (/^LILBOT_.*(?:TEST|CHECK|DEV)_/.test(key) || ['LILBOT_BOT_IDS', 'LILBOT_SKIP_MEMORY_SETUP', 'LILBOT_LIVE_MODEL'].includes(key))
    )
    if (testSetting) throw new Error(`Production refuses test-only setting: ${testSetting}`)
    return
  }
  assertDevelopmentTarget(env, rules)
  const requiredPathVars = ['LILBOT_DATA_DIR', 'LILBOT_WORKSPACES_DIR', 'LILBOT_SKILLS_DIR', ...validated.requiredDevPathVars]
  for (const key of new Set(requiredPathVars)) {
    if (!env[key] || !inside(env[key]!, developmentHome)) throw new Error(`Development requires ${key} under ${developmentHome}`)
  }
  if (!env.LILBOT_PORT || !Number.isInteger(Number(env.LILBOT_PORT)) || Number(env.LILBOT_PORT) < 1) throw new Error('Development requires its own port')
}
