/** All SQL for `mcp_connections`: the services bots added, without any credential. */
import type { Database } from 'bun:sqlite'
import type { McpService, McpServiceState } from '../../shared/connections-schema'

export interface StoredConnection extends McpService {
  addedById: string
  requestId: string
  toolNames: string[]
}

type Row = {
  id: string
  name: string
  address: string
  state: McpServiceState
  added_by: string
  added_by_name: string
  request_id: string
  created_at: number
  last_worked_at: number | null
  tools: string
}

const fromRow = (row: Row): StoredConnection => {
  const toolNames: string[] = JSON.parse(row.tools)
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    state: row.state,
    addedBy: row.added_by_name,
    addedById: row.added_by,
    requestId: row.request_id,
    createdAt: row.created_at,
    lastWorkedAt: row.last_worked_at,
    tools: toolNames.length,
    toolNames
  }
}

export class McpConnectionStore {
  constructor(private db: Database) {}

  list(): StoredConnection[] {
    return this.db.query<Row, []>('SELECT * FROM mcp_connections ORDER BY created_at, id').all().map(fromRow)
  }

  get(id: string): StoredConnection | null {
    const row = this.db.query<Row, [string]>('SELECT * FROM mcp_connections WHERE id = ?').get(id)
    return row ? fromRow(row) : null
  }

  byName(name: string): StoredConnection | null {
    const row = this.db.query<Row, [string]>('SELECT * FROM mcp_connections WHERE name = ?').get(name)
    return row ? fromRow(row) : null
  }

  byRequest(botId: string, requestId: string): StoredConnection | null {
    const row = this.db.query<Row, [string, string]>('SELECT * FROM mcp_connections WHERE added_by = ? AND request_id = ?').get(botId, requestId)
    return row ? fromRow(row) : null
  }

  insert(connection: Omit<StoredConnection, 'tools' | 'lastWorkedAt'>) {
    this.db
      .query('INSERT INTO mcp_connections(id, name, address, state, added_by, added_by_name, request_id, created_at, tools) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(
        connection.id,
        connection.name,
        connection.address,
        connection.state,
        connection.addedById,
        connection.addedBy,
        connection.requestId,
        connection.createdAt,
        JSON.stringify(connection.toolNames)
      )
  }

  /** Returns whether the state changed. */
  setState(id: string, state: McpServiceState): boolean {
    return this.db.query('UPDATE mcp_connections SET state = ? WHERE id = ? AND state <> ?').run(state, id, state).changes > 0
  }

  setTools(id: string, tools: string[]) {
    this.db.query('UPDATE mcp_connections SET tools = ? WHERE id = ?').run(JSON.stringify(tools), id)
  }

  worked(id: string, at: number) {
    this.db.query('UPDATE mcp_connections SET last_worked_at = ? WHERE id = ?').run(at, id)
  }

  delete(id: string) {
    this.db.query('DELETE FROM mcp_connections WHERE id = ?').run(id)
  }
}
