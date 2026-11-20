/** "Add this computer" from the browser on that computer: one attempt mints one ordinary install code and later
 *  learns which computer registered with it. The code's own rules (single use, 10 minutes, HMAC registration
 *  through the helper door) are unchanged. */
import { codeId } from '../../helper/frame-auth'
import type { AddThisStart, AddThisStatus, AddThisSystem } from '../../shared/computer-add-schema'
import { LilBotError } from '../../shared/protocol'
import type { ComputerService } from './computer-service'
import type { HelperDownloads } from './helper-downloads'

const KEEP_MS = 24 * 60 * 60_000
export class AddThisComputer {
  constructor(
    private computers: ComputerService,
    private downloads: HelperDownloads
  ) {}

  /** The helper door origin, also for the command-line install. */
  get helperUrl() {
    return this.downloads.settings?.door
  }

  /** `deviceId`: the device this page runs on; when the computer registers, that device is tied to it. */
  start(name: string, system: AddThisSystem, deviceId?: string): AddThisStart {
    if (system.os !== 'macos' && system.os !== 'linux') return { supported: false, reason: 'system' }
    const settings = this.downloads.settings
    const downloads = this.downloads.offer(system)
    if (!settings || !downloads.length) return { supported: false, reason: 'unavailable' }
    const { code, expiresAt } = this.computers.auth.code(name)
    const db = this.computers.store.db
    const attemptId = crypto.randomUUID()
    db.query('DELETE FROM computer_attempt_devices WHERE code_id IN (SELECT code_id FROM computer_attempts WHERE expires_at < ?)').run(Date.now() - KEEP_MS)
    db.query('DELETE FROM computer_attempts WHERE expires_at < ?').run(Date.now() - KEEP_MS)
    db.query('INSERT INTO computer_attempts(id,code_id,expires_at) VALUES(?,?,?)').run(attemptId, codeId(code), expiresAt)
    if (deviceId) db.query('INSERT INTO computer_attempt_devices(code_id,device_id) VALUES(?,?)').run(codeId(code), deviceId)
    const short = code.split('.')[0]
    return { supported: true, attemptId, expiresAt, code: short, handoverUrl: `http://127.0.0.1:${settings.port}`, link: `lilbot-helper://register#${short}`, downloads }
  }

  status(attemptId: string): AddThisStatus {
    const row = this.computers.store.db.query('SELECT expires_at,computer_id FROM computer_attempts WHERE id=?').get(attemptId) as {
      expires_at: number
      computer_id: string | null
    } | null
    if (!row) throw new LilBotError('not_found', 'This attempt is unknown. Start again.')
    const computer = row.computer_id ? this.computers.list().find(c => c.id === row.computer_id) : undefined
    if (computer) return { state: computer.online ? 'connected' : 'registered', expiresAt: row.expires_at, computer }
    return { state: row.computer_id || row.expires_at <= Date.now() ? 'expired' : 'waiting', expiresAt: row.expires_at }
  }
}
