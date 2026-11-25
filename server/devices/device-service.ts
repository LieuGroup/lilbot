/** Devices and where a chat message came from. Nothing here is a security boundary: a device id comes from the browser,
 *  and the private and Access listeners are already Oscar-only. It only tells bots which computer "my computer" means. */
import type { Database } from 'bun:sqlite'
import type { AttachmentMessage } from '../../shared/attachment-schema'
import type { ChatItem } from '../../shared/chat-schema'
import type { Device, DeviceComputer } from '../../shared/device-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { EventFrame } from '../../shared/protocol'
import type { ComputerService } from '../computers/computer-service'
import { MainComputer } from '../computers/main-computer'
import type { OpenChat, TurnOrigin } from '../engines/bot-engine'
import type { HistoryRow } from '../history/history-store'
import { type DeviceRecord, DeviceStore } from './device-store'
import { deviceLine, type LinkedComputer, unknownDeviceLine } from './origin-line'
import { OriginStore } from './origin-store'

export class DeviceService {
  constructor(
    private store: DeviceStore,
    private origins: OriginStore,
    private computers: ComputerService,
    /** The main computer is part of what "my computer" means, so `computers.setMain` is served here. */
    readonly main: MainComputer,
    private changed: () => void,
    /** Tells every open browser about a message with its origin (the `user.message` event). */
    private sent: (chatId: string, message: AttachmentMessage) => void,
    private now: () => number = Date.now
  ) {}

  /** The first call from a browser makes its record, named by the client's guess; later calls ignore the name. */
  current(deviceId: string, name: string): Device {
    return this.view(this.store.touch(deviceId, name, this.now()))
  }

  exists(deviceId: string): boolean {
    return Boolean(this.store.get(deviceId))
  }

  rename(deviceId: string, name: string): Device {
    if (!this.store.rename(deviceId, name)) throw this.unknown()
    this.changed()
    return this.view(this.require(deviceId))
  }

  linkComputer(deviceId: string, computerId: string | null): Device {
    if (computerId !== null && !this.computers.list().some(computer => computer.id === computerId)) throw new LilBotError('computer_not_found', 'This computer does not exist.')
    if (!this.store.link(deviceId, computerId)) throw this.unknown()
    this.changed()
    return this.view(this.require(deviceId))
  }

  /** The computer just added from this device's browser is the one it runs on. */
  linkFromRegistration(deviceId: string | null, computerId: string) {
    if (deviceId && this.store.link(deviceId, computerId)) this.changed()
  }

  /** What a message from this device carries: the line the model reads, and the device stored with the message. */
  origin(deviceId?: string): TurnOrigin {
    const record = deviceId ? this.store.get(deviceId) : undefined
    if (!record) return { line: unknownDeviceLine }
    this.store.seen(record.id, this.now())
    return { line: deviceLine(record.name, this.linked(record)), device: { deviceId: record.id, name: record.name } }
  }

  /** Sends a plain message with its origin. Its device is remembered before the engine sees it, so the history importer can find it. */
  async send(chat: OpenChat, text: string, messageId: string, origin: TurnOrigin) {
    const { botId, chatId } = chat.snapshot
    if (origin.device) this.origins.record(botId, messageId, text, origin.device, this.now())
    try {
      await chat.send(text, { inputId: messageId, origin })
    } catch (error) {
      this.origins.forget(messageId)
      throw error
    }
    this.sent(chatId, { messageId, text, attachments: [], images: { support: 'unknown', imageCount: 0 }, ...(origin.device ? { origin: origin.device } : {}) })
  }

  /** Gives imported user rows their device. Messages with files already carry theirs in their own record. */
  mergeRows(botId: string, rows: HistoryRow[]): HistoryRow[] {
    return rows.map(row => {
      const item: ChatItem = row.item
      if (item.kind !== 'user' || item.origin) return row
      const origin = this.origins.match(botId, row.id, item.text.trim(), row.at)
      return origin ? { ...row, item: { ...item, origin } } : row
    })
  }

  forgetBot(botId: string) {
    this.origins.forgetBot(botId)
  }

  private require(deviceId: string) {
    const record = this.store.get(deviceId)
    if (!record) throw this.unknown()
    return record
  }

  private unknown() {
    return new LilBotError('device_not_found', 'This device is not known. Reload the page.')
  }

  /** The computer this device runs on, when it still exists. */
  private linked(record: DeviceRecord): LinkedComputer | undefined {
    const computer = record.computerId ? this.computers.list().find(candidate => candidate.id === record.computerId) : undefined
    return computer && { id: computer.id, name: computer.name, online: computer.online }
  }

  private view(record: DeviceRecord): Device {
    const linked = this.linked(record)
    const main = this.computers.list().find(computer => computer.main)
    const resolves: DeviceComputer = linked
      ? { via: 'linked', computerId: linked.id, name: linked.name, online: linked.online }
      : main
        ? { via: 'main', computerId: main.id, name: main.name, online: main.online }
        : { via: 'none' }
    return { id: record.id, name: record.name, computerId: linked?.id ?? null, resolves }
  }
}

export function createDevices(db: Database, computers: ComputerService, publish: (frame: EventFrame) => void) {
  const devices = new DeviceService(
    new DeviceStore(db),
    new OriginStore(db),
    computers,
    new MainComputer(computers.store, () => publish({ event: 'computers.changed' })),
    () => publish({ event: 'devices.changed' }),
    (chatId, message) => publish({ event: 'chat', chatId, data: { type: 'user.message', ...message } })
  )
  computers.auth.registered = (computer, device) => devices.linkFromRegistration(device, computer)
  return devices
}
