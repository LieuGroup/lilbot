import { connect, createServer, type Socket } from 'node:net'

/** A timer that ran late may be made up by this much, so a busy machine does not pull the link below its rate. */
const CATCH_UP_MS = 250

/** Pace the helper uplink, including WebSocket framing, with TCP backpressure. Parts leave on a schedule that follows the rate,
 *  not after a sleep each: a sleep that overshoots would lower the rate and stretch the gaps between heartbeats past the server's limit. */
export async function throttledProxy(port: number, bytesPerSecond: number) {
  const sockets = new Set<Socket>()
  const server = createServer(client => {
    const upstream = connect(port, '127.0.0.1')
    for (const socket of [client, upstream]) {
      sockets.add(socket)
      socket.on('error', () => {})
      socket.on('close', () => {
        sockets.delete(socket)
        client.destroy()
        upstream.destroy()
      })
    }
    upstream.pipe(client)
    void (async () => {
      let due = 0
      try {
        for await (const chunk of client) {
          for (let offset = 0; offset < chunk.length; offset += 16_384) {
            const part = chunk.subarray(offset, offset + 16_384)
            const now = performance.now()
            due = Math.max(due, now - CATCH_UP_MS)
            if (due > now) await Bun.sleep(due - now)
            due += (part.length / bytesPerSecond) * 1000
            if (upstream.destroyed) return
            if (!upstream.write(part)) await new Promise<void>(resolve => upstream.once('drain', resolve))
          }
        }
      } catch {
        upstream.destroy()
      }
    })()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close() {
      for (const socket of sockets) socket.destroy()
      server.close()
    }
  }
}
