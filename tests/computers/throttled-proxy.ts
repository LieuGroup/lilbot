import { connect, createServer, type Socket } from 'node:net'

/** Pace the helper uplink, including WebSocket framing, with TCP backpressure. */
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
      try {
        for await (const chunk of client) {
          for (let offset = 0; offset < chunk.length; offset += 16_384) {
            const part = chunk.subarray(offset, offset + 16_384)
            await Bun.sleep((part.length / bytesPerSecond) * 1000)
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
