/** Durable bot identity and its engine binding. Engine data is imported once, never refreshed over it. */
import type { Database } from 'bun:sqlite'
import type { BotIdentity } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/protocol'

export type BotRecord = BotIdentity & { instructions: string; engineId: string; engineBotId: string }
type Row = { id: string; name: string; function: string; instructions: string; model: string | null; is_default: number; engine_id: string; engine_bot_id: string }
const fromRow = (row: Row): BotRecord => ({
  id: row.id,
  name: row.name,
  function: row.function,
  instructions: row.instructions,
  model: row.model ? JSON.parse(row.model) : null,
  isDefault: Boolean(row.is_default),
  engineId: row.engine_id,
  engineBotId: row.engine_bot_id
})

export class BotStore {
  constructor(private db: Database) {}

  list(): BotRecord[] {
    return (this.db.query('SELECT * FROM bots ORDER BY is_default DESC, name, id').all() as Row[]).map(fromRow)
  }

  get(id: string): BotRecord {
    const row = this.db.query('SELECT * FROM bots WHERE id = ?').get(id) as Row | null
    if (!row) throw new LilBotError('bot_not_found', 'That bot does not exist.')
    return fromRow(row)
  }

  save(bot: BotRecord) {
    this.db
      .query(`INSERT INTO bots (id, name, function, instructions, model, is_default, engine_id, engine_bot_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, function=excluded.function, instructions=excluded.instructions, model=excluded.model, is_default=excluded.is_default`)
      .run(bot.id, bot.name, bot.function, bot.instructions, bot.model ? JSON.stringify(bot.model) : null, Number(bot.isDefault), bot.engineId, bot.engineBotId)
  }

  creationDone(id: string): boolean {
    return Boolean(this.db.query('SELECT 1 FROM bot_creations WHERE bot_id = ?').get(id))
  }

  finishCreation(id: string) {
    this.db.query('INSERT OR IGNORE INTO bot_creations (bot_id) VALUES (?)').run(id)
  }

  bind(id: string, engineBotId: string) {
    this.db.query('UPDATE bots SET engine_bot_id = ? WHERE id = ?').run(engineBotId, id)
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
