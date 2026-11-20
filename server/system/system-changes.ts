/** Who changed what in LilBot through its own MCP server, so Oscar can see which bot did it. Rows hold the
 *  tool, the thing changed and the names of the fields, never the new values (instructions can be long
 *  and private). Append-only; a deleted bot's rows stay, with the name it had. All SQL for the table is here. */
import type { Database } from 'bun:sqlite'

export interface SystemChange {
  at: number
  botId: string
  botName: string
  tool: string
  /** The bot, fact or section that was changed. */
  target: string
  fields: string
}

type Row = { at: number; bot_id: string; bot_name: string; tool: string; target: string; fields: string }

export class SystemChanges {
  constructor(private db: Database) {}

  record(change: SystemChange) {
    this.db
      .query('INSERT INTO system_changes (at, bot_id, bot_name, tool, target, fields) VALUES (?, ?, ?, ?, ?, ?)')
      .run(change.at, change.botId, change.botName, change.tool, change.target, change.fields)
  }

  /** The newest changes first. */
  recent(limit: number): SystemChange[] {
    return this.db
      .query<Row, [number]>('SELECT at, bot_id, bot_name, tool, target, fields FROM system_changes ORDER BY id DESC LIMIT ?')
      .all(limit)
      .map(row => ({ at: row.at, botId: row.bot_id, botName: row.bot_name, tool: row.tool, target: row.target, fields: row.fields }))
  }
}
