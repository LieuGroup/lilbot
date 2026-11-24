import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { botCapability } from '../../server/bots/bot-capability'
import { BotSkills } from '../../server/bots/bot-skills'
import { openDatabase } from '../../server/database/database'
import type { BotEngine } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { createEngineApi } from '../../server/http/engine-api'
import { SkillsService } from '../../server/skills/skills-service'
import { addBot, systemFixture } from '../system/system-fixture'

const skillDoc = (name: string, description: string, body = 'Follow the steps.') => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`

function setupRoute() {
  const f = systemFixture()
  const hermesStub = {
    id: 'hermes',
    alwaysOnSkills: [{ name: 'hermes-agent', reason: 'Always on.' }],
    bundledSkills: () => ['hermes-bundled']
  } as unknown as BotEngine
  const scriptedStub = {
    id: 'scripted',
    alwaysOnSkills: [{ name: 'scripted-core', reason: 'Always on.' }],
    bundledSkills: () => ['scripted-bundled']
  } as unknown as BotEngine
  const registry = new EngineRegistry([hermesStub, scriptedStub], 'scripted')
  const runtimes = {
    require: async (id: string) => ({ ...f.store.get(id), engineId: 'scripted', engineBotId: 'native-s1' }),
    state: async () => null,
    bound: (engineId?: string) => (engineId === 'scripted' ? [{ ...f.store.get('b1'), engineId: 'scripted', engineBotId: 'native-s1' }] : []),
    snapshot: () => null,
    reapplySkills: async () => {}
  }
  ;(f.service as unknown as { skills: BotSkills }).skills = new BotSkills(f.skills, runtimes as never, registry, () => {})
  const api = createEngineApi(f.memory, 'tok', 3997, {
    skills: f.skills,
    changes: f.changes,
    bots: f.service,
    botExists: id => f.store.exists(id)
  })
  const post = async (botId: string, path: string, body: Record<string, unknown>) => {
    const res = await api(
      new Request(`http://127.0.0.1:3997${path}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:3997', authorization: 'Bearer tok', 'x-lilbot-bot-capability': botCapability('tok', botId) },
        body: JSON.stringify(body)
      }),
      path
    )
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  return { f, post }
}

test('/engine/skills/write allows ordinary shared writes (including Oscar and other bots), updates author, and logs system_changes without body', async () => {
  const { f, post } = setupRoute()
  const other = await addBot(f, 'Other')
  f.skills.write({ action: 'create', name: 'oscar-skill', content: skillDoc('oscar-skill', 'By Oscar.', 'Original.') }, 'oscar')
  f.skills.write({ action: 'create', name: 'other-skill', content: skillDoc('other-skill', 'By Other.', 'Other body.') }, other.id)

  expect((await post('b1', '/engine/skills/write', { action: 'create', name: 'fresh-skill', content: skillDoc('fresh-skill', 'Fresh.', 'SECRET_BODY_1') })).status).toBe(200)
  expect((await post('b1', '/engine/skills/write', { action: 'edit', name: 'oscar-skill', content: skillDoc('oscar-skill', 'Edited.', 'SECRET_BODY_2') })).status).toBe(200)
  expect((await post('b1', '/engine/skills/write', { action: 'patch', name: 'other-skill', old_string: 'Other body.', new_string: 'SECRET_BODY_3' })).status).toBe(200)
  expect((await post('b1', '/engine/skills/write', { action: 'write_file', name: 'fresh-skill', file_path: 'references/ok_1-2.md', content: 'SECRET_BODY_4' })).status).toBe(200)

  for (const name of ['fresh-skill', 'oscar-skill', 'other-skill']) {
    expect(f.skills.list('b1').find(s => s.name === name)?.author).toBe('b1')
  }
  const logs = f.changes.recent(20).filter(row => row.tool === 'skill_manage')
  expect(logs).toHaveLength(4)
  for (const row of logs) {
    expect(row.botId).toBe('b1')
    expect(row.fields).not.toContain('SECRET_BODY')
  }
})

test('/engine/skills/write refuses built-ins, dormant built-in, lilbot-/lilbot_ names, cross-engine skills, unsafe file_path, secrets, and symlinks', async () => {
  const { f, post } = setupRoute()
  f.skills.provide('lilbot-work', { 'SKILL.md': skillDoc('lilbot-work', 'Built-in work.') })
  f.skills.provide('lilbot-check', { 'SKILL.md': skillDoc('lilbot-check', 'Built-in check.') })
  f.skills.provide('lilbot-coding', { 'SKILL.md': skillDoc('lilbot-coding', 'Built-in coding.') })
  f.skills.provide('shipped', { 'SKILL.md': skillDoc('shipped', 'Provided built-in.') })
  f.skills.import('hermes', 'profile-a', { 'SKILL.md': skillDoc('engine-imported', 'Imported.') })
  f.skills.write({ action: 'create', name: 'own-skill', content: skillDoc('own-skill', 'Own.') }, 'b1')

  const refused: Record<string, unknown>[] = [
    { action: 'edit', name: 'lilbot-work', content: skillDoc('lilbot-work', 'Hijack.') },
    { action: 'patch', name: 'lilbot-check', old_string: 'Follow', new_string: 'Skip' },
    { action: 'write_file', name: 'lilbot-coding', file_path: 'references/extra.md', content: 'Inject.' },
    { action: 'edit', name: 'shipped', content: skillDoc('shipped', 'Hijack.') },
    { action: 'create', name: 't3-coding', content: skillDoc('t3-coding', 'Dormant.') },
    { action: 'create', name: 'lilbot_work', content: skillDoc('lilbot_work', 'Lookalike.') },
    { action: 'create', name: 'lilbot_check', content: skillDoc('lilbot_check', 'Lookalike.') },
    { action: 'create', name: 'lilbot-work-v2', content: skillDoc('lilbot-work-v2', 'Lookalike.') },
    { action: 'edit', name: 'engine-imported', content: skillDoc('engine-imported', 'Hijack.') },
    { action: 'create', name: 'hermes-agent', content: skillDoc('hermes-agent', 'Cross-engine always-on.') },
    { action: 'create', name: 'hermes-bundled', content: skillDoc('hermes-bundled', 'Cross-engine bundled.') },
    { action: 'create', name: 'scripted-core', content: skillDoc('scripted-core', 'Own-engine always-on.') },
    { action: 'create', name: 'scripted-bundled', content: skillDoc('scripted-bundled', 'Own-engine bundled.') },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u202eb\nc.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\nb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\rb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\tb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u200bb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u2066b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\ufeffb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: '../outside.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: '/etc/passwd', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: '.env', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'a\\b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'a//b.md', content: 'bad' },
    { action: 'create', name: 'too-big', content: `${skillDoc('too-big', 'Big.')}${'a'.repeat(200_001)}` },
    { action: 'edit', name: 'own-skill', content: skillDoc('own-skill', 'Leak.', 'api_key = supersecretvalue123') },
    { action: 'edit', name: 'missing-skill', content: skillDoc('missing-skill', 'Missing.') }
  ]

  const logsBefore = f.changes.recent(50).length
  for (const bad of refused) {
    expect((await post('b1', '/engine/skills/write', bad)).status, `route should refuse ${JSON.stringify(bad).slice(0, 90)}`).toBeGreaterThanOrEqual(400)
  }
  symlinkSync(f.root, join(f.skills.root, 'own-skill', 'redirect'))
  expect((await post('b1', '/engine/skills/write', { action: 'write_file', name: 'own-skill', file_path: 'redirect/pwn.md', content: 'x' })).status).toBe(422)
  expect((await post('b1', '/engine/skills/read', { name: 'own-skill', file_path: 'references/a\u202eb.md' })).status).toBe(422)
  expect((await post('b1', '/engine/skills/read', { name: 'own-skill', file_path: 'toString' })).body.content).toBeUndefined()
  expect(f.changes.recent(50).length).toBe(logsBefore)
})

test('startup provide prunes extra files, dotfiles, binaries, empty dirs, and symlinks; remove reclaims bot-created dormant built-ins', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-startup-reconcile-'))
  const db = openDatabase(':memory:')
  try {
    const skills = new SkillsService(root, db)
    const shipped = { 'SKILL.md': skillDoc('lilbot-work', 'Shipped work.') }
    skills.provide('lilbot-work', shipped)

    // Plant extra UTF-8 file, binary file, dotfile, empty subdir, symlink, and tampered SKILL.md inside built-in folder.
    const dir = join(root, 'lilbot-work')
    mkdirSync(join(dir, 'references'), { recursive: true })
    mkdirSync(join(dir, 'empty-dir'), { recursive: true })
    writeFileSync(join(dir, 'references', 'extra.md'), 'Unwanted.')
    writeFileSync(join(dir, 'evil.bin'), Buffer.from([0xff, 0xfe, 0x00, 0x01]))
    writeFileSync(join(dir, '.hidden'), 'dot')
    const outside = join(root, 'outside.txt')
    writeFileSync(outside, 'keep')
    symlinkSync(outside, join(dir, 'link'))
    writeFileSync(join(dir, 'SKILL.md'), skillDoc('lilbot-work', 'Tampered.'))

    skills.provide('lilbot-work', shipped)
    expect(Object.keys(skills.read('lilbot-work'))).toEqual(['SKILL.md'])
    expect(skills.read('lilbot-work')['SKILL.md']).toBe(shipped['SKILL.md'])
    expect(existsSync(join(dir, 'references'))).toBe(false)
    expect(existsSync(join(dir, 'empty-dir'))).toBe(false)
    expect(existsSync(join(dir, 'evil.bin'))).toBe(false)
    expect(existsSync(join(dir, '.hidden'))).toBe(false)
    expect(existsSync(join(dir, 'link'))).toBe(false)
    expect(existsSync(outside)).toBe(true) // Symlink was unlinked, never followed.

    // Dormant built-in created by a bot is reclaimed at startup; Oscar's own or ordinary bot skills are left alone.
    skills.write({ action: 'create', name: 't3-coding', content: skillDoc('t3-coding', 'Bot spoof.') }, 'bot-a')
    expect(skills.remove('t3-coding')).toBe(true)
    expect(existsSync(join(root, 't3-coding'))).toBe(false)
    expect(skills.list('bot-a').some(s => s.name === 't3-coding')).toBe(false)

    skills.write({ action: 'create', name: 't3-coding', content: skillDoc('t3-coding', 'Oscar own.') }, 'oscar')
    expect(skills.remove('t3-coding')).toBe(false)
    expect(existsSync(join(root, 't3-coding'))).toBe(true)
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
