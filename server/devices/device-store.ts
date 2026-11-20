import type { Database } from 'bun:sqlite'

export interface DeviceRecord {
  id: string
  name: string
  computerId: string | null
}

const STALE_MS = 180 * 24 * 60 * 60_000
type Row = { id: string; name: string; computer_id: string | null }
const record = (row: Row | null): DeviceRecord | undefined => (row ? { id: row.id, name: row.name, computerId: row.computer_id } : undefined)

/** One row per browser or app install. The id is kept by the client; nothing here is a security boundary. */
export class DeviceStore {
  constructor(private db: Database) {}
  get(id: string) {
    return record(this.db.query('SELECT id,name,computer_id FROM devices WHERE id=?').get(id) as Row | null)
  }
  /** The first sight of a device makes its record with the client's name; later ones keep the saved name and link. */
  touch(id: string, name: string, now: number): DeviceRecord {
    this.db.query('DELETE FROM devices WHERE last_seen < ?').run(now - STALE_MS)
    this.db.query('INSERT INTO devices(id,name,created_at,last_seen) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen').run(id, name, now, now)
    return this.get(id)!
  }
  seen(id: string, now: number) {
    this.db.query('UPDATE devices SET last_seen=? WHERE id=?').run(now, id)
  }
  rename(id: string, name: string) {
    return this.db.query('UPDATE devices SET name=? WHERE id=?').run(name, id).changes > 0
  }
  link(id: string, computerId: string | null) {
    return this.db.query('UPDATE devices SET computer_id=? WHERE id=?').run(computerId, id).changes > 0
  }
}
