import { Database } from 'bun:sqlite'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { type ComputerOperation, type ComputerResult, HelperWork } from '../shared/computer-schema'
import { configDir, connectionHeaders, type Identity } from './identity'
import { operate } from './operations'

export async function run(identity: Identity, signal: AbortSignal) {
  const lock = new Database(join(configDir, 'runner.lock'))
  lock.exec('BEGIN EXCLUSIVE')
  const path = join(configDir, 'requests.db')
  const db = new Database(path, { create: true })
  chmodSync(path, 0o600)
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, result TEXT);')
  // A receipt is written BEFORE side effects. Interrupted operations must never run twice.
  db.query('UPDATE requests SET result=? WHERE result IS NULL').run(JSON.stringify({ output: '', error: 'Helper restarted during operation; outcome unknown. Not re-executed.' }))
  const active = new Map<string, AbortController>()
  let delay = 500
  let socket: WebSocket | undefined
  const send = (id: string, result: ComputerResult, final: boolean) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'result', id, result, final }))
  }
  const work = async (id: string, operation: ComputerOperation) => {
    const previous = db.query('SELECT result FROM requests WHERE id=?').get(id) as { result: string | null } | null
    if (previous) {
      if (previous.result) send(id, JSON.parse(previous.result), true)
      return
    }
    if (active.size >= 8) {
      db.query('INSERT INTO requests(id,result) VALUES(?,?)').run(id, JSON.stringify({ output: '', error: 'Helper busy; submit a new request later.' }))
      send(id, { output: '', error: 'Helper busy; submit a new request later.' }, true)
      return
    }
    db.query('INSERT INTO requests(id) VALUES(?)').run(id)
    const controller = new AbortController()
    active.set(id, controller)
    let result: ComputerResult
    try {
      result = await operate(operation, controller.signal, result => send(id, result, false))
    } catch {
      result = { output: '', error: 'Operation failed.' }
    }
    db.query('UPDATE requests SET result=? WHERE id=?').run(JSON.stringify(result), id)
    active.delete(id)
    send(id, result, true)
  }
  const stop = () => {
    socket?.close()
    for (const controller of active.values()) controller.abort()
  }
  signal.addEventListener('abort', stop)
  try {
    while (!signal.aborted) {
      await new Promise<void>(resolve => {
        socket = new WebSocket(`${identity.url.replace(/^http/, 'ws')}/helper/connect`, { headers: connectionHeaders(identity) } as any)
        const timeout = setTimeout(() => socket?.close(), 15_000)
        let lastHeartbeat = Date.now()
        const timer = setInterval(() => {
          if (Date.now() - lastHeartbeat > 35_000) socket?.close()
          else if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat' }))
        }, 10_000)
        socket.onopen = () => {
          clearTimeout(timeout)
          delay = 500
          socket?.send(JSON.stringify({ type: 'heartbeat' }))
        }
        socket.onmessage = event => {
          try {
            const frame = HelperWork.parse(JSON.parse(String(event.data)))
            if (frame.type === 'heartbeat') lastHeartbeat = Date.now()
            else if (frame.type === 'cancel') {
              active.get(frame.id)?.abort()
              db.query('INSERT OR IGNORE INTO requests(id,result) VALUES(?,?)').run(frame.id, JSON.stringify({ output: '', error: 'Cancelled.' }))
            } else void work(frame.id, frame.operation).catch(() => socket?.close())
          } catch {
            socket?.close()
          }
        }
        socket.onerror = () => socket?.close()
        socket.onclose = event => {
          if (event.code === 1008) for (const controller of active.values()) controller.abort()
          clearInterval(timer)
          clearTimeout(timeout)
          resolve()
        }
      })
      if (!signal.aborted)
        await new Promise<void>(resolve => {
          const done = () => {
            clearTimeout(timer)
            signal.removeEventListener('abort', done)
            resolve()
          }
          const timer = setTimeout(done, delay + Math.random() * 250)
          signal.addEventListener('abort', done, { once: true })
        })
      delay = Math.min(delay * 2, 30_000)
    }
    while (active.size) await Bun.sleep(50)
  } finally {
    signal.removeEventListener('abort', stop)
    db.close()
    lock.close()
  }
}
