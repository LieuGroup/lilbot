/** Verifies server-side WebSocket ping/pong keeps idle visible presence alive while a silent/dead socket expires. */
import { expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { createDevices } from '../../server/devices/device-service'
import type { SocketData } from '../../server/http/app-routes'
import { BrowserSession } from '../../server/http/browser-session'
import { createBrowserWebSocket } from '../../server/http/browser-ws'
import { TestNotificationSender } from '../../server/notifications/notification-sender'
import { NotificationService } from '../../server/notifications/notification-service'
import { NotificationStore } from '../../server/notifications/notification-store'
import { fakeService } from '../helpers/fake-engine'
import { until } from '../helpers/until'

const D1 = '66666666-6666-4666-8666-666666666666'
const D2 = '77777777-7777-4777-8777-777777777777'

/** Encodes a masked RFC 6455 client text frame so a raw TCP socket can speak `/ws` without answering server pings. */
function maskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const mask = randomBytes(4)
  const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.from([0x81, 0xfe, payload.length >> 8, payload.length & 0xff])
  const masked = Buffer.alloc(payload.length)
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ mask[i % 4]!
  return Buffer.concat([header, mask, masked])
}

test('idle open WebSocket refreshes presence via server ping/pong past TTL while a silent socket expires', async () => {
  const fake = fakeService()
  const devices = createDevices(fake.database, { list: () => [], store: {}, auth: {} } as never, () => {})
  const sender = new TestNotificationSender(['test'])
  const notifications = new NotificationService(new NotificationStore(fake.database), sender, {
    deviceExists: id => devices.exists(id),
    botName: () => 'Bot One',
    presenceTtlMs: 120,
    replyCooldownMs: 0
  })
  const { websocket, stop } = createBrowserWebSocket({
    topic: 'everyone',
    pingIntervalMs: 30,
    createSession: socket =>
      new BrowserSession(
        fake.service,
        frame => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        devices,
        undefined,
        undefined,
        undefined,
        notifications
      )
  })
  const server = Bun.serve<SocketData>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, srv) {
      return srv.upgrade(request, { data: {} }) ? undefined : new Response('upgrade', { status: 400 })
    },
    websocket
  })
  let ws: WebSocket | undefined
  let silentSocket: Awaited<ReturnType<typeof Bun.connect>> | undefined
  try {
    // 1. Live WebSocket auto-replies pong to server pings and stays suppressed past 120ms TTL with zero JSON traffic.
    ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`)
    await new Promise<void>((resolve, reject) => {
      ws!.onopen = () => resolve()
      ws!.onerror = () => reject(new Error('ws open failed'))
    })
    const rpc = (id: number, method: string, params: Record<string, unknown>) =>
      new Promise<void>((resolve, reject) => {
        const onMsg = (ev: MessageEvent) => {
          const msg = JSON.parse(String(ev.data)) as { id?: number; ok?: boolean }
          if (msg.id !== id) return
          ws!.removeEventListener('message', onMsg)
          if (msg.ok) resolve()
          else reject(new Error(`rpc ${method} failed`))
        }
        ws!.addEventListener('message', onMsg)
        ws!.send(JSON.stringify({ id, method, params }))
      })
    await rpc(1, 'devices.current', { deviceId: D1, name: 'Live Phone' })
    await rpc(2, 'notifications.register', { deviceId: D1, channel: 'test', token: 'tok-live-1234', bundleId: 'com.lilbot.app' })
    await rpc(3, 'notifications.presence', { deviceId: D1, foreground: true, botId: 'b1' })

    // 2. Raw TCP WebSocket client completes upgrade and sets presence, then ignores server pings (frozen/half-open client).
    let upgraded = false
    silentSocket = await Bun.connect({
      hostname: '127.0.0.1',
      port: server.port!,
      socket: {
        data(_sock, chunk) {
          if (!upgraded && Buffer.from(chunk).toString('utf8').includes('101 Switching Protocols')) upgraded = true
        }
      }
    })
    const key = randomBytes(16).toString('base64')
    silentSocket.write(
      `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
    )
    await until(() => upgraded)
    silentSocket.write(maskedTextFrame(JSON.stringify({ id: 1, method: 'devices.current', params: { deviceId: D2, name: 'Frozen Phone' } })))
    await until(() => devices.exists(D2))
    notifications.register(D2, 'test', 'tok-silent-1234', 'com.lilbot.app')
    silentSocket.write(maskedTextFrame(JSON.stringify({ id: 2, method: 'notifications.presence', params: { deviceId: D2, foreground: true, botId: 'b1' } })))
    await until(() => notifications.presence.isViewingBot(D2, 'b1'))

    await new Promise(resolve => setTimeout(resolve, 220))
    expect(notifications.presence.isViewingBot(D1, 'b1')).toBe(true)
    expect(notifications.presence.isViewingBot(D2, 'b1')).toBe(false)

    const res = await notifications.notifyReply({ botId: 'b1', chatId: 'c1', text: 'Finished long turn', dedupeKey: 'r-liveness' })
    expect(res).toEqual({ sent: 1, suppressed: 1, deduped: 0, failed: 0 })
    expect(sender.sent.map(item => item.recipient.deviceId)).toEqual([D2])
  } finally {
    ws?.close()
    silentSocket?.end()
    stop()
    server.stop(true)
  }
})
