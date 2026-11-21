/** Schema step 34, the MCP services bots add (#187). A row is what bots and Oscar may see: never a token, which lives
 *  only in `<data>/mcp-credentials.json`. Removing a service deletes its row. Per-bot switches (#62) can join a table of
 *  their own without changing this one. */
export const MCP_CONNECTION_TABLES = `CREATE TABLE IF NOT EXISTS mcp_connections(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, address TEXT NOT NULL, state TEXT NOT NULL,
     added_by TEXT NOT NULL, added_by_name TEXT NOT NULL, request_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_worked_at INTEGER, tools TEXT NOT NULL DEFAULT '[]',
     UNIQUE(added_by, request_id));`
