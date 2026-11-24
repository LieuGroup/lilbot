import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { botCapability } from '../../server/bots/bot-capability'
import { BotSkills } from '../../server/bots/bot-skills'
import { openDatabase } from '../../server/database/database'
import type { BotEngine } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { createEngineApi } from '../../server/http/engine-api'
import { SkillsService } from '../../server/skills/skills-service'
import { systemFixture } from '../system/system-fixture'

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

test('/engine/skills/write refuses built-ins, dormant built-in, lilbot-/lilbot_ names, cross-engine skills, unsafe paths, secrets, and symlinks', async () => {
  const { f, post } = setupRoute()
  f.skills.provide('lilbot-work', { 'SKILL.md': skillDoc('lilbot-work', 'Built-in work.') })
  f.skills.provide('lilbot-check', { 'SKILL.md': skillDoc('lilbot-check', 'Built-in check.') })
  f.skills.provide('lilbot-coding', { 'SKILL.md': skillDoc('lilbot-coding', 'Built-in coding.') })
  f.skills.provide('shipped', { 'SKILL.md': skillDoc('shipped', 'Provided built-in.') })
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
    { action: 'create', name: 'hermes-agent', content: skillDoc('hermes-agent', 'Cross-engine always-on.') },
    { action: 'create', name: 'hermes-bundled', content: skillDoc('hermes-bundled', 'Cross-engine bundled.') },
    { action: 'create', name: 'scripted-core', content: skillDoc('scripted-core', 'Own-engine always-on.') },
    { action: 'create', name: 'scripted-bundled', content: skillDoc('scripted-bundled', 'Own-engine bundled.') },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u202eb\nc.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\nb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\rb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\tb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u0085b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u009fb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u2028b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u2029b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u200bb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u2066b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\ufeffb.md', content: 'bad' },
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

  // Test read guards BEFORE planting any symlink so safeSkillFilePath and Object.hasOwn are exercised directly.
  for (const badPath of ['references/a\u202eb.md', 'references/a\u0085b.md', 'references/a\u2028b.md']) {
    expect(await post('b1', '/engine/skills/read', { name: 'own-skill', file_path: badPath })).toEqual({ status: 422, body: { error: 'Use a relative skill file path.' } })
  }
  expect(await post('b1', '/engine/skills/read', { name: 'own-skill', file_path: 'toString' })).toEqual({ status: 200, body: {} })

  // Symlink inside skill folder is rejected without creating a change-log row.
  symlinkSync(f.root, join(f.skills.root, 'own-skill', 'redirect'))
  expect((await post('b1', '/engine/skills/write', { action: 'write_file', name: 'own-skill', file_path: 'redirect/pwn.md', content: 'x' })).status).toBe(422)
  expect(f.changes.recent(50).length).toBe(logsBefore)
})

test('symlinked root with trailing slash, dangling built-in symlink, and fs write collisions leak no host path or stray tmp files', async () => {
  const { f, post } = setupRoute()
  f.skills.write({ action: 'create', name: 'own-skill', content: skillDoc('own-skill', 'Own.') }, 'b1')
  f.skills.write({ action: 'write_file', name: 'own-skill', file_path: 'references/note.md', content: 'ok' }, 'b1')

  // EEXIST (SKILL.md/sub.md) and EISDIR (writing over existing references/ dir): generic 500, no host path, no stray .tmp.
  const eexist = await post('b1', '/engine/skills/write', { action: 'write_file', name: 'own-skill', file_path: 'SKILL.md/sub.md', content: 'x' })
  expect(eexist).toEqual({ status: 500, body: { error: 'Request failed.' } })
  const eisdir = await post('b1', '/engine/skills/write', { action: 'write_file', name: 'own-skill', file_path: 'references', content: 'x' })
  expect(eisdir).toEqual({ status: 500, body: { error: 'Request failed.' } })
  expect(readdirSync(join(f.skills.root, 'own-skill')).filter(name => name.endsWith('.tmp'))).toEqual([])

  // Dangling symlink at a built-in skill folder is refused cleanly with unsafe_skill (no host path leak).
  symlinkSync(join(f.root, 'does-not-exist'), join(f.skills.root, 'lilbot-work'))
  expect(() => f.skills.provide('lilbot-work', { 'SKILL.md': skillDoc('lilbot-work', 'Shipped.') })).toThrow('Skill symlinks are not supported.')
  const dangling = await post('b1', '/engine/skills/write', { action: 'create', name: 'lilbot-work', content: skillDoc('lilbot-work', 'Bad.') })
  expect(dangling).toEqual({ status: 422, body: { error: 'Skill symlinks are not supported.' } })

  // Trailing slash on a symlinked library root still triggers unsafe_skill and leaves the target untouched.
  const realTarget = join(f.root, 'real-skills-dir')
  const linkRoot = join(f.root, 'link-skills-dir')
  mkdirSync(realTarget, { recursive: true })
  symlinkSync(realTarget, linkRoot)
  const db = openDatabase(':memory:')
  try {
    const linked = new SkillsService(`${linkRoot}/`, db)
    expect(() => linked.provide('lilbot-work', { 'SKILL.md': skillDoc('lilbot-work', 'Shipped.') })).toThrow('Skill symlinks are not supported.')
    expect(readdirSync(realTarget)).toEqual([])
  } finally {
    db.close()
  }
})

test('startup provide prunes extra files, dotfiles, binaries, empty dirs, and symlinks; remove reclaims bot-created dormant built-ins', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-startup-reconcile-'))
  const db = openDatabase(':memory:')
  try {
    const skills = new SkillsService(root, db)
    const shipped = { 'SKILL.md': skillDoc('lilbot-work', 'Shipped work.') }
    skills.provide('lilbot-work', shipped)

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
    for (const gone of ['references', 'empty-dir', 'evil.bin', '.hidden', 'link']) expect(existsSync(join(dir, gone))).toBe(false)
    expect(existsSync(outside)).toBe(true)

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
