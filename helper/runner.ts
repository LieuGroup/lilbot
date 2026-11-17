import { Database } from 'bun:sqlite'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { type ComputerOperation, type ComputerResult, HelperWork } from '../shared/computer-schema'
import { configDir, connectionHeaders, type Identity } from './identity'
import { acknowledge, finish, prepareJournal, pruneJournal } from './journal'
import { operate } from './operations'
import { boundResult } from './result-bounds'
import { verifyFrame, verifyServer } from './server-trust'

export async function run(identity: Identity, signal: AbortSignal) {
  const lock = new Database(join(configDir, 'runner.lock'))
  lock.exec('BEGIN EXCLUSIVE')
  const path = join(configDir, 'requests.db')
  const db = new Database(path, { create: true })
  chmodSync(path, 0o600)
  prepareJournal(db)
  const active = new Map<string, AbortController>()
  let delay = 500
  let socket: WebSocket | undefined
  let authenticated = false
  const send = (id: string, result: ComputerResult, final: boolean) => {
    if (authenticated && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'result', id, result: boundResult(result), final }))
  }
  const work = async (id: string, operation: ComputerOperation) => {
    const previous = db.query('SELECT result FROM requests WHERE id=?').get(id) as { result: string | null } | null
    if (previous) {
      if (previous.result) send(id, JSON.parse(previous.result), true)
      return
    }
    if (active.size >= 8) {
      db.query('INSERT INTO requests(id,result,finished_at) VALUES(?,?,?)').run(id, JSON.stringify({ output: '', error: 'Helper busy; submit a new request later.' }), Date.now())
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
    result = boundResult(result)
    finish(db, id, result)
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
        const headers = connectionHeaders(identity)
        authenticated = false
        let serverKey = ''
        let sequence = 0
        socket = new WebSocket(`${identity.url.replace(/^http/, 'ws')}/helper/connect`, { headers } as any)
        const timeout = setTimeout(() => socket?.close(), 15_000)
        let lastHeartbeat = Date.now()
        const timer = setInterval(() => {
          pruneJournal(db)
          if (Date.now() - lastHeartbeat > 35_000) socket?.close()
          else if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat' }))
        }, 10_000)
        socket.onopen = () => {
          socket?.send(JSON.stringify({ type: 'heartbeat' }))
        }
        socket.onmessage = event => {
          try {
            const raw = JSON.parse(String(event.data))
            if (!authenticated) {
              authenticated = raw.type === 'server' && verifyServer(identity.serverFingerprint, identity.id, headers['x-lilbot-nonce'], raw)
              if (!authenticated) socket?.close()
              else {
                delay = 500
                serverKey = raw.publicKey
                clearTimeout(timeout)
              }
              return
            }
            if (!verifyFrame(serverKey, identity.id, headers['x-lilbot-nonce'], sequence++, raw)) {
              socket?.close()
              return
            }
            const frame = HelperWork.parse(JSON.parse(raw.payload))
            if (frame.type === 'heartbeat') lastHeartbeat = Date.now()
            else if (frame.type === 'revoked') {
              for (const controller of active.values()) controller.abort()
              socket?.close()
            } else if (frame.type === 'ack') acknowledge(db, frame.id)
            else if (frame.type === 'cancel') {
              active.get(frame.id)?.abort()
              if (!active.has(frame.id)) {
                db.query('INSERT OR IGNORE INTO requests(id,result,finished_at) VALUES(?,?,?)').run(frame.id, JSON.stringify({ output: '', error: 'Cancelled.' }), Date.now())
                const stored = db.query('SELECT result FROM requests WHERE id=?').get(frame.id) as { result: string }
                send(frame.id, JSON.parse(stored.result), true)
              }
            } else void work(frame.id, frame.operation).catch(() => socket?.close())
          } catch {
            socket?.close()
          }
        }
        socket.onerror = () => socket?.close()
        socket.onclose = event => {
          if (event.code === 4001) delay = 30_000
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
