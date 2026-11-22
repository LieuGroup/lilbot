import { expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotRuntimes } from '../../server/bots/bot-runtimes'
import { isT3Enabled, t3Connection } from '../../server/connections/t3-connection'
import { openDatabase } from '../../server/database/database'
import type { McpConnection } from '../../server/engines/mcp-connection'
import { files } from '../../server/skills/skill-files'
import { SkillsService } from '../../server/skills/skills-service'
import { fakeService } from '../helpers/fake-engine'

test('every bot’s runtime is given LilBot’s connections, with its own key, before use', async () => {
  const { store, engine } = fakeService()
  store.save({ ...store.get('b1'), id: 'b2', engineBotId: 'native-2' })
  const given: { id: string; connections: McpConnection[] }[] = []
  engine.prepareConnections = async (id, connections) => {
    given.push({ id, connections })
  }
  const runtimes = new BotRuntimes(store, engine, undefined, undefined, botId => [t3Connection('http://127.0.0.1:3370', 'token', botId)])
  await runtimes.initialize()
  expect(given.map(entry => entry.id).sort()).toEqual(['native-2', 'native-b1'])
  const forB2 = given.find(entry => entry.id === 'native-2')!.connections[0]
  expect(forB2.bearerToken).toBe(t3Connection('http://127.0.0.1:3370', 'token', 'b2').bearerToken)
})

test('the coding skill ships with LilBot, passes the skill safety rules and is restored when changed', () => {
  const root = mkdtempSync(join(tmpdir(), 'coding-skill-test-'))
  const db = openDatabase(':memory:')
  try {
    const skills = new SkillsService(root, db)
    const shipped = files(join(import.meta.dir, '../../server/connections/t3-coding-skill'))
    skills.provide('t3-coding', shipped)
    const skill = skills.list('any-bot').find(s => s.name === 't3-coding')
    expect(skill?.author).toBe('lilbot')
    expect(skill?.enabled).toBe(true)
    expect(skill?.description).toContain('coding task')
    expect(shipped['SKILL.md']).toContain('~/code/home/AGENTS.md')
    expect(shipped['SKILL.md']).toContain('clientRequestId')
    skills.write({ name: 't3-coding', action: 'edit', content: shipped['SKILL.md'].replace('Launch once', 'Launch twice') }, 'bot-a')
    skills.provide('t3-coding', shipped)
    expect(skills.read('t3-coding')['SKILL.md']).toBe(shipped['SKILL.md'])
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a sign-in change gives every available bot its connections again', async () => {
  const { store, engine } = fakeService()
  let signIn = 'signed-out'
  const urls: string[] = []
  engine.prepareConnections = async (_id, connections) => {
    urls.push(connections[0].url)
  }
  const runtimes = new BotRuntimes(store, engine, undefined, undefined, botId => [t3Connection('http://127.0.0.1:3370', 'token', botId, signIn)])
  await runtimes.initialize()
  signIn = '1700000000000'
  await runtimes.refreshConnections()
  expect(urls).toEqual(['http://127.0.0.1:3370/engine/t3/mcp?signin=signed-out', 'http://127.0.0.1:3370/engine/t3/mcp?signin=1700000000000'])
})

test('the native coding skill ships with LilBot, passes safety rules, mentions no T3, and removes t3-coding cleanly', () => {
  expect(isT3Enabled({})).toBe(false)
  expect(isT3Enabled({ LILBOT_T3_ENABLED: '0' })).toBe(false)
  expect(isT3Enabled({ LILBOT_T3_ENABLED: '1' })).toBe(true)
  const root = mkdtempSync(join(tmpdir(), 'native-coding-skill-test-'))
  const db = openDatabase(':memory:')
  try {
    const skills = new SkillsService(root, db)
    const legacy = files(join(import.meta.dir, '../../server/connections/t3-coding-skill'))
    skills.provide('t3-coding', legacy)
    skills.setEnabled('bot-a', 't3-coding', false)
    const shipped = files(join(import.meta.dir, '../../server/threads/coding-skill'))
    skills.provide('lilbot-coding', shipped)
    expect(skills.remove('t3-coding')).toBe(true)
    expect(skills.remove('t3-coding')).toBe(false)
    expect(skills.list('any-bot').map(s => s.name)).toEqual(['lilbot-coding'])
    expect(shipped['SKILL.md']).not.toMatch(/t3_thread_|t3-coding|T3 Code/i)
    for (const part of [
      'wins over any older instruction naming T3',
      'thinking-only',
      'lilbot_delegate',
      'worker: true',
      'lilbot_bots_list',
      'lilbot_work',
      'needs_oscar',
      'lilbot_memory_save',
      'update_memory',
      'writes findings and progress'
    ])
      expect(shipped['SKILL.md']).toContain(part)
    skills.write({ name: 'lilbot-coding', action: 'edit', content: shipped['SKILL.md'].replace('Write a complete brief', 'Write a short brief') }, 'bot-a')
    skills.provide('lilbot-coding', shipped)
    expect(skills.read('lilbot-coding')['SKILL.md']).toBe(shipped['SKILL.md'])
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('SkillsService.remove deletes only LilBot-installed built-ins and leaves Oscar, bot, engine-imported, or untracked skills untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-remove-guard-'))
  const db = openDatabase(':memory:')
  try {
    const skills = new SkillsService(root, db)
    const body = (name: string) => `---\nname: ${name}\ndescription: Custom skill\n---\nKeep this.`
    skills.write({ name: 'oscar-skill', action: 'create', content: body('oscar-skill') }, 'oscar')
    skills.write({ name: 'bot-skill', action: 'create', content: body('bot-skill') }, 'bot-a')
    skills.import('hermes', '/tmp/source-engine-skill', { 'SKILL.md': body('engine-skill') })
    const untracked = join(root, 'untracked-skill')
    mkdirSync(untracked, { recursive: true })
    writeFileSync(join(untracked, 'SKILL.md'), body('untracked-skill'))
    skills.provide('built-in', { 'SKILL.md': body('built-in') })
    expect(skills.remove('oscar-skill')).toBe(false)
    expect(skills.remove('bot-skill')).toBe(false)
    expect(skills.remove('engine-skill')).toBe(false)
    expect(skills.remove('untracked-skill')).toBe(false)
    expect(skills.read('oscar-skill')['SKILL.md']).toBe(body('oscar-skill'))
    expect(skills.read('bot-skill')['SKILL.md']).toBe(body('bot-skill'))
    expect(skills.read('engine-skill')['SKILL.md']).toBe(body('engine-skill'))
    expect(skills.read('untracked-skill')['SKILL.md']).toBe(body('untracked-skill'))
    expect(skills.remove('built-in')).toBe(true)
    expect(skills.list('any-bot').map(s => s.name)).not.toContain('built-in')
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('onConnectionsChanged fires only when prepareConnections reports a real profile change', async () => {
  const { store, engine } = fakeService()
  let changed = true
  const notified: string[] = []
  engine.prepareConnections = async () => changed
  const runtimes = new BotRuntimes(store, engine, undefined, undefined, botId => [t3Connection('http://127.0.0.1:3370', 'token', botId)], {
    onConnectionsChanged: botId => notified.push(botId)
  })
  await runtimes.initialize()
  expect(notified).toEqual(['b1'])
  changed = false
  await runtimes.refreshConnections()
  expect(notified).toEqual(['b1'])
  changed = true
  await runtimes.refreshConnections()
  expect(notified).toEqual(['b1', 'b1'])
})

test('failed connection refresh remains retryable and does not log engine payloads', async () => {
  const f = fakeService()
  const log = spyOn(console, 'error').mockImplementation(() => {})
  let fail = false
  let calls = 0
  f.engine.prepareConnections = async () => {
    calls++
    if (fail) throw new Error('secret connection payload')
  }
  const runtimes = new BotRuntimes(f.store, f.engine, undefined, undefined, () => [])
  try {
    await runtimes.initialize()
    fail = true
    await expect(runtimes.refreshConnections()).rejects.toThrow('Connection refresh incomplete')
    fail = false
    await runtimes.refreshConnections()
    expect(calls).toBe(2)
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
  } finally {
    log.mockRestore()
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})
