import { expect, test } from 'bun:test'
import { BotSkills } from '../../server/bots/bot-skills'
import type { BotEngine } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { addBot, systemFixture } from './system-fixture'

const skillDoc = (name: string, description: string, body = 'Follow the steps.') => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`

test('lilbot_skill_manage creates, edits, patches, adds files, allows editing ordinary shared skills, enforces caller key, and logs without content', async () => {
  const f = systemFixture()
  const other = await addBot(f, 'Other')

  // Forged botId/callerId/author arguments are ignored; caller comes strictly from the bot-bound key.
  const created = await f.call('b1', 'lilbot_skill_manage', {
    action: 'create',
    name: 'deploy-notes',
    content: skillDoc('deploy-notes', 'Deploy steps.', 'Step 1: run verify.'),
    botId: other.id,
    callerId: other.id,
    author: 'oscar'
  })
  expect(created.error).toBeUndefined()
  expect(f.skills.list('b1').find(s => s.name === 'deploy-notes')).toMatchObject({ author: 'b1', origin: { kind: 'bot', botId: 'b1' }, enabled: true })

  expect(
    (await f.call('b1', 'lilbot_skill_manage', { action: 'edit', name: 'deploy-notes', content: skillDoc('deploy-notes', 'Updated.', 'Step 1: verify.') })).error
  ).toBeUndefined()
  expect(
    (await f.call('b1', 'lilbot_skill_manage', { action: 'patch', name: 'deploy-notes', old_string: 'Step 1: verify.', new_string: 'Step 1: verify and deploy.' })).error
  ).toBeUndefined()
  expect(
    (await f.call('b1', 'lilbot_skill_manage', { action: 'write_file', name: 'deploy-notes', file_path: 'references/check.md', content: 'Check health.' })).error
  ).toBeUndefined()

  // Another bot can update an ordinary shared skill (including Oscar's or another bot's), updating author honestly.
  f.skills.write({ action: 'create', name: 'oscar-skill', content: skillDoc('oscar-skill', 'By Oscar.', 'Original.') }, 'oscar')
  expect(
    (await f.call(other.id, 'lilbot_skill_manage', { action: 'edit', name: 'deploy-notes', content: skillDoc('deploy-notes', 'By Other.', 'Step 1: other edit.') })).error
  ).toBeUndefined()
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'patch', name: 'oscar-skill', old_string: 'Original.', new_string: 'Improved by b1.' })).error).toBeUndefined()
  expect(f.skills.list('b1').find(s => s.name === 'deploy-notes')).toMatchObject({ author: other.id })
  expect(f.skills.list('b1').find(s => s.name === 'oscar-skill')).toMatchObject({ author: 'b1' })

  const read = (await f.call('b1', 'lilbot_skill_read', { name: 'deploy-notes' })).data
  expect(read.content).toContain('Step 1: other edit.')
  expect(read.files).toEqual(['SKILL.md', 'references/check.md'])

  // Per-bot toggle affects only the calling bot, not other bots.
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'set_enabled', name: 'deploy-notes', enabled: false })).error).toBeUndefined()
  expect(f.skills.list('b1').find(s => s.name === 'deploy-notes')?.enabled).toBe(false)
  expect(f.skills.list(other.id).find(s => s.name === 'deploy-notes')?.enabled).toBe(true)
  expect((await f.call('b1', 'lilbot_skill_read', { name: 'deploy-notes' })).error).toContain('disabled')

  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'set_enabled', name: 'deploy-notes', enabled: true })).error).toBeUndefined()
  expect(f.skills.list('b1').find(s => s.name === 'deploy-notes')?.enabled).toBe(true)

  // Every write is logged in system_changes with field names only, never the skill body.
  const logs = f.changes.recent(20).filter(row => row.tool === 'lilbot_skill_manage')
  expect(logs).toHaveLength(8)
  for (const row of logs) {
    expect(row.fields).not.toContain('Step 1:')
    expect(row.fields).not.toContain('Check health.')
    expect(row.fields).not.toContain('Improved by b1.')
  }
})

test('set_enabled refuses built-in and engine skills for bots while Skills screen still lets Oscar toggle built-ins', async () => {
  const f = systemFixture()
  const hermesEngine = {
    id: 'hermes',
    alwaysOnSkills: [{ name: 'hermes-agent', reason: 'Always on.' }],
    bundledSkills: () => ['bundled-tool']
  } as unknown as BotEngine
  const runtimes = {
    require: async (id: string) => f.store.get(id),
    state: async () => null,
    bound: () => f.store.list(),
    snapshot: () => null,
    reapplySkills: async () => {}
  }
  const botSkills = new BotSkills(f.skills, runtimes as never, new EngineRegistry([hermesEngine]), () => {})
  ;(f.service as unknown as { skills: BotSkills }).skills = botSkills

  f.skills.provide('lilbot-work', { 'SKILL.md': skillDoc('lilbot-work', 'Built-in work.') })
  f.skills.provide('lilbot-check', { 'SKILL.md': skillDoc('lilbot-check', 'Built-in check.') })
  f.skills.provide('shipped', { 'SKILL.md': skillDoc('shipped', 'Custom built-in.') })
  f.skills.import('hermes', 'profile-a', { 'SKILL.md': skillDoc('engine-imported', 'Imported.') })
  f.skills.setEngineIncluded('hermes', true)

  for (const name of ['lilbot-work', 'lilbot-check', 'shipped', 'engine-imported']) {
    expect((await f.call('b1', 'lilbot_skill_manage', { action: 'set_enabled', name, enabled: false })).error).toContain('owner')
    expect(f.skills.list('b1').find(s => s.name === name)?.enabled).toBe(true)
  }

  // Skills screen (`BotSkills.setEnabled`) still lets Oscar toggle built-in skills for a bot.
  await botSkills.setEnabled('b1', 'lilbot-work', false)
  expect(f.skills.list('b1').find(s => s.name === 'lilbot-work')?.enabled).toBe(false)

  // Missing enabled boolean or unknown skill is refused.
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'set_enabled', name: 'lilbot-work' })).error).toContain('enabled')
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'set_enabled', name: 'missing-skill', enabled: false })).error).toContain('does not exist')
})
