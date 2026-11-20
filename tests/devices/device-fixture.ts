/** Devices on a real database with real computer records; `online(id)` connects a computer the way a helper would. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { MainComputer } from '../../server/computers/main-computer'
import { loadServerKey } from '../../server/computers/server-key'
import { openDatabase } from '../../server/database/database'
import { DeviceService } from '../../server/devices/device-service'
import { DeviceStore } from '../../server/devices/device-store'
import { OriginStore } from '../../server/devices/origin-store'
import type { AttachmentMessage } from '../../shared/attachment-schema'

export const DEVICE_A = '11111111-1111-4111-8111-111111111111'
export const DEVICE_B = '22222222-2222-4222-8222-222222222222'

export function deviceFixture(now = { value: 1_000_000_000_000 }) {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-devices-'))
  const db = openDatabase(':memory:')
  let devicePushes = 0
  const sent: { chatId: string; message: AttachmentMessage }[] = []
  const computers = new ComputerService(
    new ComputerStore(db),
    loadServerKey(root),
    () => true,
    () => root,
    () => {},
    () => 'full-access'
  )
  const devices = new DeviceService(
    new DeviceStore(db),
    new OriginStore(db),
    computers,
    new MainComputer(computers.store, () => {}),
    () => devicePushes++,
    (chatId, message) => sent.push({ chatId, message }),
    () => now.value
  )
  const add = (id: string, name: string) => computers.store.add(id, { name, os: 'linux', home: '/home/x', capabilities: ['exec'] }, null)
  const online = (id: string) =>
    computers.connect(
      id,
      () => true,
      () => {}
    )
  return {
    db,
    now,
    computers,
    devices,
    sent,
    add,
    online,
    pushes: () => devicePushes,
    close: () => {
      computers.close()
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}
