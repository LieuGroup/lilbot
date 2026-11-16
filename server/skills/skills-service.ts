import type { Database } from 'bun:sqlite'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { z } from 'zod'
import { LilBotError } from '../../shared/protocol'
import { type Skill, SkillName, type SkillWrite } from '../../shared/skills-schema'
import { digest, files, metadata, safeText, treeDigest } from './skill-files'

export class SkillsService {
  constructor(
    readonly root: string,
    private db: Database,
    private changed = () => {}
  ) {
    mkdirSync(root, { recursive: true })
  }
  private path(name: string) {
    SkillName.parse(name)
    const path = join(this.root, name)
    if (lstatSync(this.root).isSymbolicLink() || (existsSync(path) && lstatSync(path).isSymbolicLink())) throw new LilBotError('unsafe_skill', 'Skill symlinks are not supported.')
    return path
  }
  list(botId: string): Skill[] {
    // Files added by Oscar are part of the library without an engine round trip.
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SkillName.safeParse(entry.name).success || !existsSync(join(this.root, entry.name, 'SKILL.md'))) continue
      const data = this.read(entry.name)
      const meta = metadata(data['SKILL.md'])
      if (!this.db.query('SELECT 1 FROM skills WHERE name=?').get(entry.name)) {
        this.db.query('INSERT INTO skills VALUES (?,?,?,?)').run(entry.name, meta.description, 'oscar', Date.now())
      }
    }
    return (this.db.query('SELECT * FROM skills ORDER BY name').all() as { name: string; description: string; author: string; updated_at: number }[]).map(s => ({
      name: s.name,
      description: s.description,
      author: s.author,
      updatedAt: s.updated_at,
      enabled: !this.db.query('SELECT 1 FROM skill_off WHERE bot_id=? AND name=?').get(botId, s.name)
    }))
  }
  read(name: string) {
    return files(this.path(name))
  }
  disabled(botId: string) {
    return this.list(botId)
      .filter(s => !s.enabled)
      .map(s => s.name)
  }
  setEnabled(botId: string, name: string, enabled: boolean) {
    this.read(name)
    if (enabled) this.db.query('DELETE FROM skill_off WHERE bot_id=? AND name=?').run(botId, name)
    else this.db.query('INSERT OR IGNORE INTO skill_off VALUES (?,?)').run(botId, name)
    this.changed()
  }
  write(input: z.infer<typeof SkillWrite>, author: string) {
    const target = this.path(input.name)
    if (input.action === 'create' && existsSync(target)) throw new LilBotError('skill_exists', 'This skill already exists.')
    const data = input.action === 'create' ? {} : this.read(input.name)
    const file = input.action === 'write_file' ? (input.file_path ?? '') : 'SKILL.md'
    if (!file || file.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || file.includes('\\'))
      throw new LilBotError('unsafe_path', 'Use a relative skill file path.')
    if (input.action === 'patch') {
      if (!input.old_string || !data[file]?.includes(input.old_string) || data[file].split(input.old_string).length !== 2)
        throw new LilBotError('invalid_patch', 'Patch must match exactly once.')
      data[file] = data[file].replace(input.old_string, input.new_string ?? '')
    } else data[file] = input.content ?? ''
    this.save(input.name, data, author)
    return { ok: true }
  }
  private save(name: string, data: Record<string, string>, author: string) {
    const meta = metadata(data['SKILL.md'] ?? '')
    if (meta.name !== name) throw new LilBotError('invalid_skill', 'Frontmatter name must match the skill folder.')
    if (author !== 'imported') for (const text of Object.values(data)) safeText(text)
    const target = this.path(name)
    if (existsSync(target)) files(target) // Reject redirected descendants before any writes.
    mkdirSync(target, { recursive: true })
    for (const [file, text] of Object.entries(data)) {
      const path = join(target, file)
      mkdirSync(dirname(path), { recursive: true })
      const temp = `${path}.${crypto.randomUUID()}.tmp`
      writeFileSync(temp, text)
      renameSync(temp, path)
    }
    this.db
      .query('INSERT INTO skills VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET description=excluded.description, author=excluded.author, updated_at=excluded.updated_at')
      .run(name, meta.description, author, Date.now())
    this.changed()
  }
  import(source: string, data: Record<string, string>) {
    const prior = this.db.query('SELECT name FROM skill_imports WHERE source=?').get(source)
    if (prior) return
    const original = metadata(data['SKILL.md'] ?? '').name
    SkillName.parse(original)
    const sourceHash = existsSync(source) ? treeDigest(source) : digest(data)
    let name = original
    if (existsSync(this.path(name)) && (existsSync(source) ? treeDigest(this.path(name)) !== sourceHash : digest(this.read(name)) !== sourceHash))
      name = `${original.slice(0, 85)}-${sourceHash.slice(0, 10)}`
    if (name !== original) data = { ...data, 'SKILL.md': data['SKILL.md'].replace(/^(name:\s*).*$/m, `$1${name}`) }
    if (!existsSync(this.path(name))) {
      this.save(name, data, 'imported')
      if (existsSync(source)) cpSync(source, this.path(name), { recursive: true, force: false, errorOnExist: false })
    }
    if (!this.db.query('SELECT 1 FROM skills WHERE name=?').get(name)) {
      const meta = metadata(this.read(name)['SKILL.md'])
      this.db.query('INSERT INTO skills VALUES (?,?,?,?)').run(name, meta.description, 'imported', Date.now())
    }
    this.db.query('INSERT INTO skill_imports VALUES (?,?)').run(source, name)
  }
  importedBot(id: string) {
    return Boolean(this.db.query('SELECT 1 FROM skill_imports WHERE source=?').get(`bot:${id}`))
  }
  markBotImported(id: string) {
    this.db.query('INSERT OR IGNORE INTO skill_imports VALUES (?,?)').run(`bot:${id}`, '')
  }
  forgetBot(id: string) {
    this.db.query('DELETE FROM skill_off WHERE bot_id=?').run(id)
  }
}
