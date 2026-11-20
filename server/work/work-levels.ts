/** The default check level of each kind of work: built in, Oscar's for every bot, and his for one bot. All SQL for
 *  `work_levels` is here; a bot id of '' is every bot. */
import type { Database } from 'bun:sqlite'
import { KIND_NAMES, WORK_KINDS, type WorkKind, type WorkLevels } from '../../shared/work-check-schema'

export class WorkLevelStore {
  constructor(private db: Database) {}

  /** The level a kind starts at for this bot: Oscar's for the bot, else his for every bot, else the built-in one. */
  floor(kind: WorkKind, botId: string): number {
    const row = this.db.query("SELECT level FROM work_levels WHERE kind = ? AND bot_id IN (?, '') ORDER BY bot_id = '' LIMIT 1").get(kind, botId) as { level: number } | null
    return row?.level ?? WORK_KINDS[kind]
  }

  view(): WorkLevels {
    const rows = this.db.query('SELECT kind, bot_id, level FROM work_levels').all() as { kind: WorkKind; bot_id: string; level: number }[]
    return {
      kinds: KIND_NAMES.map(kind => {
        const own = rows.filter(row => row.kind === kind)
        return {
          kind,
          builtIn: WORK_KINDS[kind],
          level: own.find(row => row.bot_id === '')?.level ?? WORK_KINDS[kind],
          bots: Object.fromEntries(own.filter(row => row.bot_id !== '').map(row => [row.bot_id, row.level]))
        }
      })
    }
  }

  /** Null removes Oscar's level, so the one under it applies again. */
  set(kind: WorkKind, botId: string | undefined, level: number | null) {
    if (level === null) this.db.query('DELETE FROM work_levels WHERE kind = ? AND bot_id = ?').run(kind, botId ?? '')
    else this.db.query('INSERT OR REPLACE INTO work_levels(kind, bot_id, level) VALUES (?,?,?)').run(kind, botId ?? '', level)
  }

  forgetBot(botId: string) {
    this.db.query('DELETE FROM work_levels WHERE bot_id = ?').run(botId)
  }
}
