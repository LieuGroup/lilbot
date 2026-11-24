import type { Database } from 'bun:sqlite'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { type Skill, SkillName, type SkillWrite } from '../../shared/skills-schema'
import { digest, files, hasExactFiles, metadata, pruneUnexpectedFiles, safeSkillFilePath, safeText, treeDigest } from './skill-files'
import { isBuiltinSkillName, isReservedSkillName, originOf } from './skill-origin'

export class SkillsService {
  private engineSkill: (name: string) => boolean = () => false
  constructor(
    readonly root: string,
    private db: Database,
    private changed = () => {}
  ) {
    mkdirSync(root, { recursive: true })
  }
  /** Wired by `BotSkills` so bot-scoped writes reject every registered engine's own skills. */
  setEngineSkillCheck(check: (name: string) => boolean) {
    this.engineSkill = check
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
    const off = new Set((this.db.query('SELECT name FROM skill_off WHERE bot_id=?').all(botId) as { name: string }[]).map(row => row.name))
    const engines = new Map((this.db.query('SELECT name, engine_id FROM skill_origins').all() as { name: string; engine_id: string }[]).map(row => [row.name, row.engine_id]))
    const on = new Set((this.db.query('SELECT engine_id FROM engine_skills WHERE included=1').all() as { engine_id: string }[]).map(row => row.engine_id))
    return (this.db.query('SELECT * FROM skills ORDER BY name').all() as { name: string; description: string; author: string; updated_at: number }[]).map(s => {
      const origin = originOf(s.author, engines.get(s.name))
      return {
        name: s.name,
        description: s.description,
        author: s.author,
        updatedAt: s.updated_at,
        enabled: !off.has(s.name),
        origin,
        excluded: origin.kind === 'engine' && !on.has(origin.engineId)
      }
    })
  }
  /** What bots are offered: not switched off for this bot and not excluded by its engine's switch. */
  offered(botId: string): Skill[] {
    return this.list(botId).filter(s => s.enabled && !s.excluded)
  }
  read(name: string) {
    return files(this.path(name))
  }
  /** The names this bot is not offered. */
  disabled(botId: string) {
    return this.list(botId)
      .filter(s => !s.enabled || s.excluded)
      .map(s => s.name)
  }
  /** An engine added after this was built has no row and starts off. */
  engineIncluded(engineId: string) {
    return Boolean((this.db.query('SELECT included FROM engine_skills WHERE engine_id=?').get(engineId) as { included: number } | null)?.included)
  }
  /** Nothing is deleted and no per-bot switch is touched, so switching back on restores the library exactly. */
  setEngineIncluded(engineId: string, included: boolean) {
    this.db.query('INSERT INTO engine_skills VALUES (?,?) ON CONFLICT(engine_id) DO UPDATE SET included=excluded.included').run(engineId, included ? 1 : 0)
    this.changed()
  }
  /** Engines with a switch or imported skills; the caller adds the one that runs. */
  engineIds() {
    return (this.db.query('SELECT engine_id FROM engine_skills UNION SELECT engine_id FROM skill_origins').all() as { engine_id: string }[]).map(row => row.engine_id)
  }
  importedFrom(engineId: string) {
    return (this.db.query('SELECT COUNT(*) AS n FROM skill_origins WHERE engine_id=?').get(engineId) as { n: number }).n
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
    if (input.action !== 'create' && !existsSync(target)) throw new LilBotError('skill_not_found', 'That skill does not exist.')
    const data = input.action === 'create' ? {} : this.read(input.name)
    const file = input.action === 'write_file' ? (input.file_path ?? '') : 'SKILL.md'
    if (!safeSkillFilePath(file)) throw new LilBotError('unsafe_path', 'Use a relative skill file path.')
    if (input.action === 'patch') {
      if (!input.old_string || !data[file]?.includes(input.old_string) || data[file].split(input.old_string).length !== 2)
        throw new LilBotError('invalid_patch', 'Patch must match exactly once.')
      data[file] = data[file].replace(input.old_string, input.new_string ?? '')
    } else data[file] = input.content ?? ''
    if (data[file].length > 200_000) throw new LilBotError('invalid_skill', 'Skill file exceeds the 200,000 character limit.')
    this.save(input.name, data, author)
    return { ok: true }
  }
  /** Bot-scoped skill write service: protects LilBot's built-in skills, reserved `lilbot-`/`lilbot_` names, and
   *  every registered engine's own and imported skills; allows creating and updating ordinary shared skills. */
  writeForBot(input: z.infer<typeof SkillWrite>, botId: string) {
    this.path(input.name)
    if (isReservedSkillName(input.name)) throw new LilBotError('skill_forbidden', "LilBot's built-in skills cannot be changed by a bot.")
    if (this.engineSkill(input.name)) throw new LilBotError('skill_forbidden', 'Engine skills are managed by the owner.')
    const existing = this.list(botId).find(skill => skill.name === input.name)
    if (existing?.origin.kind === 'lilbot') throw new LilBotError('skill_forbidden', "LilBot's built-in skills cannot be changed by a bot.")
    if (existing?.origin.kind === 'engine') throw new LilBotError('skill_forbidden', 'Engine skills are managed by the owner.')
    if (input.action === 'create' && existing) throw new LilBotError('skill_exists', 'This skill already exists.')
    if (input.action !== 'create' && !existing) throw new LilBotError('skill_not_found', 'That skill does not exist.')
    return this.write(input, botId)
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
      .query(
        "INSERT INTO skills VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET description=excluded.description, author=CASE WHEN skills.author='lilbot' AND excluded.author<>'oscar' THEN 'lilbot' ELSE excluded.author END, updated_at=excluded.updated_at"
      )
      .run(name, meta.description, author, Date.now())
    this.changed()
  }
  import(engineId: string, source: string, data: Record<string, string>) {
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
    // A skill this import wrote belongs to the engine; an identical copy merged into one that already existed keeps its own origin.
    if (this.db.query("SELECT 1 FROM skills WHERE name=? AND author='imported'").get(name)) this.db.query('INSERT OR IGNORE INTO skill_origins VALUES (?,?)').run(name, engineId)
  }
  /** Installs a skill LilBot itself ships, restoring its exact shipped files and author when the library copy differs. */
  provide(name: string, data: Record<string, string>) {
    const target = this.path(name)
    const expected = new Set(Object.keys(data))
    const row = this.db.query('SELECT author FROM skills WHERE name=?').get(name) as { author: string } | null
    if (existsSync(target) && row?.author === 'lilbot' && hasExactFiles(target, expected) && digest(this.read(name)) === digest(data)) return
    if (existsSync(target)) pruneUnexpectedFiles(target, expected)
    this.save(name, data, 'lilbot')
  }
  /** Removes a LilBot built-in skill (including a bot-created dormant built-in), leaving Oscar-authored, ordinary
   *  bot-authored, engine-imported, or untracked skills untouched. */
  remove(name: string): boolean {
    const target = this.path(name)
    const row = this.db.query('SELECT author FROM skills WHERE name=?').get(name) as { author: string } | null
    const imported = Boolean(this.db.query('SELECT 1 FROM skill_origins WHERE name=?').get(name))
    const botDormant = isBuiltinSkillName(name) && row !== null && row.author !== 'oscar'
    if ((row?.author !== 'lilbot' && !botDormant) || imported) return false
    if (existsSync(target)) rmSync(target, { recursive: true, force: true })
    this.db.query('DELETE FROM skill_off WHERE name=?').run(name)
    this.db.query('DELETE FROM skills WHERE name=?').run(name)
    this.changed()
    return true
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
