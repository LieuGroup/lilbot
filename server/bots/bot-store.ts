/** Durable bot identity and its engine binding. Engine data is imported once, never refreshed over it. */
import type { Database } from 'bun:sqlite'
import type { BotIdentity } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/lilbot-error'

export type BotRecord = BotIdentity & { instructions: string; engineId: string; engineBotId: string }
type Row = {
  id: string
  name: string
  function: string
  instructions: string
  model: string | null
  reasoning_effort: BotIdentity['reasoningEffort']
  permission_mode: BotIdentity['permissionMode']
  is_default: number
  engine_id: string
  engine_bot_id: string
}
const fromRow = (row: Row): BotRecord => ({
  id: row.id,
  name: row.name,
  function: row.function,
  instructions: row.instructions,
  model: row.model ? JSON.parse(row.model) : null,
  reasoningEffort: row.reasoning_effort,
  isDefault: Boolean(row.is_default),
  permissionMode: row.permission_mode,
  engineId: row.engine_id,
  engineBotId: row.engine_bot_id
})

export class BotStore {
  constructor(private db: Database) {}

  list(): BotRecord[] {
    return (this.db.query('SELECT * FROM bots WHERE deletion IS NULL ORDER BY is_default DESC, name, id').all() as Row[]).map(fromRow)
  }

  exists(id: string): boolean {
    return Boolean(this.db.query('SELECT 1 FROM bots WHERE id = ? AND deletion IS NULL').get(id))
  }

  get(id: string): BotRecord {
    const row = this.db.query('SELECT * FROM bots WHERE id = ? AND deletion IS NULL').get(id) as Row | null
    if (!row) throw new LilBotError('bot_not_found', 'That bot does not exist.')
    return fromRow(row)
  }

  /** Tombstones retain names and the exact choices for retries and attribution. */
  deleted(id: string): { bot: BotRecord; choices: import('../../shared/bot-delete-schema').BotDeleteDefaults; complete: boolean } | null {
    const row = this.db.query('SELECT * FROM bots WHERE id = ? AND deletion IS NOT NULL').get(id) as (Row & { deletion: string }) | null
    return row ? { bot: fromRow(row), ...JSON.parse(row.deletion) } : null
  }

  incompleteDeletions(): string[] {
    return (this.db.query("SELECT id FROM bots WHERE deletion IS NOT NULL AND json_extract(deletion, '$.complete') = 0").all() as { id: string }[]).map(r => r.id)
  }

  markDeleted(bot: BotRecord, choices: import('../../shared/bot-delete-schema').BotDeleteDefaults, complete = false) {
    this.db.transaction(() => {
      this.db.query('UPDATE bots SET deletion = ? WHERE id = ?').run(JSON.stringify({ choices, complete }), bot.id)
      this.db.query('DELETE FROM bot_creations WHERE bot_id = ?').run(bot.id)
    })()
  }

  deleteDefaults(): import('../../shared/bot-delete-schema').BotDeleteDefaults {
    return (
      (this.db.query('SELECT files, private_memories AS privateMemories FROM bot_delete_defaults WHERE id = 1').get() as
        | import('../../shared/bot-delete-schema').BotDeleteDefaults
        | null) ?? { files: 'archive', privateMemories: 'forget' }
    )
  }

  setDeleteDefaults(choices: import('../../shared/bot-delete-schema').BotDeleteDefaults) {
    this.db
      .query('INSERT INTO bot_delete_defaults VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET files=excluded.files, private_memories=excluded.private_memories')
      .run(choices.files, choices.privateMemories)
    return choices
  }

  save(bot: BotRecord) {
    this.db
      .query(`INSERT INTO bots (id, name, function, instructions, model, reasoning_effort, is_default, engine_id, engine_bot_id, permission_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, function=excluded.function, instructions=excluded.instructions, model=excluded.model, reasoning_effort=excluded.reasoning_effort,
      is_default=excluded.is_default, permission_mode=excluded.permission_mode`)
      .run(
        bot.id,
        bot.name,
        bot.function,
        bot.instructions,
        bot.model ? JSON.stringify(bot.model) : null,
        bot.reasoningEffort,
        Number(bot.isDefault),
        bot.engineId,
        bot.engineBotId,
        bot.permissionMode
      )
  }

  creationDone(id: string): boolean {
    return Boolean(this.db.query('SELECT 1 FROM bot_creations WHERE bot_id = ?').get(id))
  }

  finishCreation(id: string) {
    this.db.query('INSERT OR IGNORE INTO bot_creations (bot_id) SELECT id FROM bots WHERE id = ? AND deletion IS NULL').run(id)
  }

  bind(id: string, engineBotId: string) {
    this.db.query('UPDATE bots SET engine_bot_id = ? WHERE id = ?').run(engineBotId, id)
  }

  bindEngine(id: string, engineId: string, engineBotId: string, model: BotIdentity['model'], isDefault = false) {
    this.db
      .query('UPDATE bots SET engine_id = ?, engine_bot_id = ?, model = ?, is_default = ? WHERE id = ?')
      .run(engineId, engineBotId, model ? JSON.stringify(model) : null, Number(isDefault), id)
  }

  imported(engineId: string): boolean {
    return Boolean(this.db.query('SELECT 1 FROM bot_imports WHERE engine_id = ?').get(engineId))
  }

  /** Commit the whole import and its marker together, so a failed discovery can safely retry. */
  import(engineId: string, bots: BotRecord[]) {
    this.db.transaction(() => {
      if (this.imported(engineId)) return
      for (const bot of bots) this.save(bot)
      this.db.query('INSERT INTO bot_imports (engine_id) VALUES (?)').run(engineId)
    })()
  }
}
