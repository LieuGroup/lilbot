import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import type { SkillSettings } from '../../server/engines/bot-engine'
import { bundledSkillNames, skillsFingerprint } from '../../server/engines/hermes/hermes-skills'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { originOf } from '../../server/skills/skill-origin'
import { SkillsService } from '../../server/skills/skills-service'
import { detail, fakeEngine, nativeBotId } from '../helpers/fake-engine'

const content = (name: string, text = 'Follow this procedure.') => `---\nname: ${name}\ndescription: A workflow\n---\n${text}`
const settled = async (done: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !done(); attempt++) await Bun.sleep(10)
}
const scratch = () => mkdtempSync(join(tmpdir(), 'engine-skills-'))

test('origin: shipped by LilBot first, then the engine it was imported from, then who wrote it', () => {
  expect(originOf('lilbot', 'hermes')).toEqual({ kind: 'lilbot' })
  expect(originOf('imported', 'hermes')).toEqual({ kind: 'engine', engineId: 'hermes' })
  expect(originOf('bot-a', 'hermes')).toEqual({ kind: 'engine', engineId: 'hermes' })
  expect(originOf('oscar', undefined)).toEqual({ kind: 'oscar' })
  expect(originOf('bot-a', undefined)).toEqual({ kind: 'bot', botId: 'bot-a' })
})

test('the switch excludes an engine’s skills for every bot and restores them with per-bot switches intact', () => {
  const root = scratch()
  const db = openDatabase(':memory:')
  try {
    const pushes: number[] = []
    const skills = new SkillsService(join(root, 'skills'), db, () => pushes.push(1))
    skills.import('hermes', 'profile-a', { 'SKILL.md': content('from-hermes') })
    skills.import('other', 'profile-b', { 'SKILL.md': content('from-other') })
    skills.write({ name: 'by-oscar', action: 'create', content: content('by-oscar') }, 'oscar')
    skills.write({ name: 'by-bot', action: 'create', content: content('by-bot') }, 'bot-a')
    skills.provide('shipped', { 'SKILL.md': content('shipped') })
    skills.setEnabled('a', 'from-hermes', false)
    const origins = () => Object.fromEntries(skills.list('b').map(s => [s.name, s.origin]))
    expect(origins()).toEqual({
      'from-hermes': { kind: 'engine', engineId: 'hermes' },
      'from-other': { kind: 'engine', engineId: 'other' },
      'by-oscar': { kind: 'oscar' },
      'by-bot': { kind: 'bot', botId: 'bot-a' },
      shipped: { kind: 'lilbot' }
    })
    // An engine nobody switched on starts off: nothing from it is offered.
    expect(skills.engineIncluded('hermes')).toBe(false)
    expect(skills.offered('b').map(s => s.name)).toEqual(['by-bot', 'by-oscar', 'shipped'])
    skills.setEngineIncluded('hermes', true)
    expect(skills.offered('b').map(s => s.name)).toEqual(['by-bot', 'by-oscar', 'from-hermes', 'shipped'])
    expect(skills.offered('a').map(s => s.name)).toEqual(['by-bot', 'by-oscar', 'shipped'])
    const before = JSON.stringify(skills.list('a'))
    const files = skills.read('from-hermes')
    skills.setEngineIncluded('hermes', false)
    expect(skills.list('a').find(s => s.name === 'from-hermes')).toMatchObject({ excluded: true, enabled: false })
    expect(skills.list('b').find(s => s.name === 'from-hermes')).toMatchObject({ excluded: true, enabled: true })
    expect(skills.offered('b').some(s => s.name === 'from-hermes')).toBe(false)
    expect(skills.disabled('b')).toContain('from-hermes')
    expect(skills.read('from-hermes')).toEqual(files)
    skills.setEngineIncluded('hermes', true)
    expect(JSON.stringify(skills.list('a'))).toBe(before)
    expect(skills.list('b').find(s => s.name === 'from-hermes')).toMatchObject({ excluded: false, enabled: true })
    expect(pushes.length).toBeGreaterThan(0)
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('an imported skill a bot improved stays with its engine; an identical copy merged into someone’s own skill does not', () => {
  const root = scratch()
  const db = openDatabase(':memory:')
  try {
    const skills = new SkillsService(join(root, 'skills'), db)
    skills.write({ name: 'mine', action: 'create', content: content('mine') }, 'oscar')
    skills.import('hermes', 'profile-a', { 'SKILL.md': content('mine') })
    skills.import('hermes', 'profile-b', { 'SKILL.md': content('theirs') })
    skills.write({ name: 'theirs', action: 'edit', content: content('theirs', 'Improved') }, 'bot-a')
    const byName = Object.fromEntries(skills.list('a').map(s => [s.name, s]))
    expect(byName.mine).toMatchObject({ origin: { kind: 'oscar' }, excluded: false })
    expect(byName.theirs).toMatchObject({ author: 'bot-a', origin: { kind: 'engine', engineId: 'hermes' }, excluded: true })
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('migration: an install with bots keeps its engine on and its imports attributed; a fresh database starts off', () => {
  const root = scratch()
  const path = join(root, 'db')
  let db = openDatabase(path)
  try {
    expect(db.query('SELECT * FROM engine_skills').all()).toEqual([])
    new BotStore(db).import('hermes', [{ ...detail, engineId: 'hermes', engineBotId: nativeBotId }])
    db.exec(`INSERT INTO skills VALUES ('imported-one','d','imported',1), ('improved','d','bot-a',1), ('mine','d','oscar',1), ('shipped','d','lilbot',1);
      INSERT INTO skill_imports VALUES ('/p/imported-one','imported-one'), ('/p/improved','improved'), ('/p/mine','mine'), ('bot:b1','')`)
    db.exec(
      'DROP TABLE engine_skills; DROP TABLE skill_origins; ALTER TABLE work_items DROP COLUMN kind; ALTER TABLE work_items DROP COLUMN default_level; ALTER TABLE webhooks DROP COLUMN capabilities; ALTER TABLE webhook_runs DROP COLUMN message; ALTER TABLE webhook_runs DROP COLUMN message_state; DROP INDEX work_items_goal; ALTER TABLE work_items DROP COLUMN goal_id; ALTER TABLE work_checks DROP COLUMN same_bot; ALTER TABLE work_checks DROP COLUMN checker_model; PRAGMA user_version = 26'
    )
    db.close()
    db = openDatabase(path)
    expect(db.query('SELECT * FROM engine_skills').all()).toEqual([{ engine_id: 'hermes', included: 1 }])
    expect(db.query('SELECT * FROM skill_origins ORDER BY name').all()).toEqual([
      { name: 'imported-one', engine_id: 'hermes' },
      { name: 'improved', engine_id: 'hermes' }
    ])
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('start-up imports from an engine only while its switch is on, and switching on imports and applies it to every bot', async () => {
  const root = scratch()
  const db = openDatabase(':memory:')
  try {
    const { engine } = fakeEngine()
    const source = join(root, 'profile', 'engine-skill')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'SKILL.md'), content('engine-skill'))
    const store = new BotStore(db)
    store.import('test', [{ ...detail, engineId: 'test', engineBotId: nativeBotId }])
    const applied: SkillSettings[] = []
    Object.assign(engine, {
      userSkillPaths: () => [source],
      bundledSkills: () => ['bundled-a', 'bundled-b'],
      alwaysOnSkills: [{ name: 'core', reason: 'Part of the engine.' }],
      configureSkills: async (_id: string, settings: SkillSettings) => void applied.push(settings)
    })
    const skills = new SkillsService(join(root, 'skills'), db)
    const bots = new BotService(engine, store, new BotPrefsStore(db), new Workspaces(join(root, 'workspaces')), new MemoryService(new MemoryStore(db)), {
      skills,
      memoryConnection: { url: 'http://localhost:1', tokenFile: '/unused' }
    })
    await bots.prepareRuntimes()
    expect(skills.list('b1')).toEqual([])
    expect(skills.importedBot('b1')).toBe(false)
    expect(applied.at(-1)?.includeEngineSkills).toBe(false)
    expect(bots.skills!.engines()).toEqual([{ id: 'test', included: false, imported: 0, bundled: 2, alwaysOn: [{ name: 'core', reason: 'Part of the engine.' }] }])
    expect(() => bots.skills!.setEngine('unknown', true)).toThrow()

    // The switch answers at once; the bot prepares its tools again in the background.
    bots.skills!.setEngine('test', true)
    await settled(() => applied.at(-1)?.includeEngineSkills === true)
    expect(applied.at(-1)?.includeEngineSkills).toBe(true)
    expect(skills.importedBot('b1')).toBe(true)
    expect(bots.skills!.engines()[0]).toMatchObject({ included: true, imported: 1 })
    expect((await bots.getBot('b1')).abilities.map(a => a.id)).toContain('engine-skill')

    bots.skills!.setEngine('test', false)
    await settled(() => applied.at(-1)?.includeEngineSkills === false)
    expect(applied.at(-1)).toMatchObject({ includeEngineSkills: false, names: ['engine-skill'], disabled: ['engine-skill'] })
    expect((await bots.getBot('b1')).abilities.map(a => a.id)).not.toContain('engine-skill')
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('Hermes: bundled skills come from the manifest without the always-on one, and the fingerprint is unchanged while its skills are included', () => {
  const root = scratch()
  const old = process.env.HERMES_HOME
  process.env.HERMES_HOME = root
  try {
    mkdirSync(join(root, 'skills'), { recursive: true })
    writeFileSync(join(root, 'skills', '.bundled_manifest'), 'hermes-agent:aaa\napple-notes:bbb\nplain-v1-name\n')
    expect(bundledSkillNames('default')).toEqual(['apple-notes', 'plain-v1-name'])
    const settings: SkillSettings = { root: 'r', url: 'u', tokenFile: 't', botId: 'b', disabled: [], names: ['x'], includeEngineSkills: true }
    const { includeEngineSkills, ...before } = settings
    expect(skillsFingerprint('default', settings)).toEqual([before, []])
    expect(skillsFingerprint('default', { ...settings, includeEngineSkills: false })).toEqual([before, [], ['apple-notes', 'plain-v1-name']])
  } finally {
    if (old === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = old
    rmSync(root, { recursive: true, force: true })
  }
})
