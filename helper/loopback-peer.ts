/** Whether the other end of a loopback connection belongs to this OS user, so another local user cannot
 *  drive the hand-over. Origin headers alone are only trustworthy from browsers. */
import { readFileSync } from 'node:fs'

const hex = (port: number) => port.toString(16).toUpperCase().padStart(4, '0')

/** Rows of /proc/net/tcp{,6}: the client's own socket has local port `client` and remote port `server`. */
export function procOwner(tables: string[], client: number, server: number): number | null {
  for (const table of tables) {
    for (const line of table.split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/)
      if (fields.length < 8 || fields[3] !== '01') continue
      const [localAddress, localPort] = fields[1].split(':')
      const [, remotePort] = fields[2].split(':')
      if (localPort === hex(client) && remotePort === hex(server) && localAddress.endsWith('0100007F')) return Number(fields[7])
    }
  }
  return null
}

/** lsof run as this user lists only this user's sockets, so finding the client end proves the owner. */
export function lsofOwned(output: string, client: number, server: number, self: number) {
  let pid = 0
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid !== self && line.slice(1) === `127.0.0.1:${client}->127.0.0.1:${server}`) return true
  }
  return false
}

export async function samePeerUser(client: number, server: number) {
  if (process.platform === 'linux') {
    const tables = ['/proc/net/tcp', '/proc/net/tcp6'].map(path => {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return ''
      }
    })
    return procOwner(tables, client, server) === process.getuid!()
  }
  if (process.platform !== 'darwin') return false
  const child = Bun.spawn(['/usr/sbin/lsof', '-nP', `-iTCP@127.0.0.1:${client}`, '-sTCP:ESTABLISHED', '-Fpn'], { stdout: 'pipe', stderr: 'ignore' })
  const output = await new Response(child.stdout).text()
  await child.exited
  return lsofOwned(output, client, server, process.pid)
}
