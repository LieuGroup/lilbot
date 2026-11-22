import { Database } from 'bun:sqlite'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { type ComputerOperation, type ComputerResult, HelperWork } from '../shared/computer-schema'
import { helperFrame } from './frame-auth'
import { configDir, connectionHeaders, type Identity } from './identity'
import { acknowledge, canAdmit, finish, prepareJournal, pruneJournal } from './journal'
import { operate } from './operations'
import { outbound } from './outbound'
import { boundResult } from './result-bounds'
import { retire } from './retire'
import { verifyFrame, verifyServer } from './server-trust'
import { createAgentProbe } from './worker-driver'
import { WorkerHost, type WorkerHostOptions } from './worker-host'

type RunnerOptions = Omit<WorkerHostOptions, 'db' | 'send' | 'emitNow'> & { configDir?: string; retire?: () => Promise<void> }

const waitBackoff = (ms: number, signal: AbortSignal) =>
  new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', abort, { once: true })
  })

export async function run(identity: Identity, signal: AbortSignal, options: RunnerOptions = {}) {
  const dir = options.configDir ?? configDir
  const lock = new Database(join(dir, 'runner.lock'))
  lock.exec('PRAGMA busy_timeout = 5000; BEGIN EXCLUSIVE')
  const path = join(dir, 'requests.db')
  const db = new Database(path, { create: true })
  db.exec('PRAGMA busy_timeout = 5000')
  chmodSync(path, 0o600)
  prepareJournal(db)
  const active = new Map<string, AbortController>()
  let delay = 500
  let socket: WebSocket | undefined
  let authenticated = false
  let revoked = false
  let outgoing = 0
  let nonce = ''
  const emit = (frame: unknown) => {
    if (!authenticated || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount >= 64_000) return false
    socket.send(helperFrame(identity.privateKey, identity.id, nonce, outgoing++, JSON.stringify(frame)))
    return true
  }
  const pendingRows = () =>
    (db.query('SELECT id FROM requests WHERE finished_at IS NOT NULL ORDER BY finished_at, id LIMIT 32').all() as { id: string }[]).map(({ id }) => ({
      id,
      result: () => (db.query('SELECT result FROM requests WHERE id=?').get(id) as { result: string }).result
    }))
  const sender = outbound(emit, pendingRows, () => authenticated && socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 64_000)
  const send = (id: string, result: ComputerResult, final: boolean) => (final ? sender.flush() : void emit({ type: 'result', id, result: boundResult(result), final }))
  const sendWorker = (key: string, frame: unknown) => {
    sender.control(key, frame)
    sender.flush()
  }
  const workers = new WorkerHost({ ...options, configDir: dir, db, send: sendWorker, emitNow: emit })
  const probe = await createAgentProbe(options.drivers, next => sendWorker('worker-capabilities', { type: 'worker.capabilities', agents: next }))
  const work = async (id: string, operation: ComputerOperation) => {
    const previous = db.query('SELECT result,finished_at FROM requests WHERE id=?').get(id) as { result: string | null; finished_at: number | null } | null
    if (previous) {
      if (previous.result) {
        sender.receipt(id, previous.result)
        sender.flush()
      }
      return
    }
    if (active.size >= 8 || !canAdmit(db)) {
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
    workers.stopAll()
  }
  signal.addEventListener('abort', stop)
  try {
    while (!signal.aborted && !revoked) {
      probe.refresh()
      await new Promise<void>(resolve => {
        const headers = connectionHeaders(identity)
        authenticated = false
        outgoing = 0
        sender.reset()
        nonce = headers['x-lilbot-nonce']
        let serverKey = ''
        let sequence = 0
        socket = new WebSocket(`${identity.url.replace(/^http/, 'ws')}/helper/connect`, { headers } as any)
        const timeout = setTimeout(() => socket?.close(), 15_000)
        let lastHeartbeat = Date.now()
        let nextHeartbeat = 0
        const timer = setInterval(() => {
          try {
            pruneJournal(db)
            if (Date.now() - lastHeartbeat > 35_000) socket?.close()
            else {
              if (Date.now() >= nextHeartbeat) {
                sender.heartbeat()
                nextHeartbeat = Date.now() + 10_000
              }
              probe.refresh()
              sender.flush()
            }
          } catch {
            console.error('[helper] heartbeat failed; will retry on the next tick.')
          }
        }, 100)

        socket.onmessage = event => {
          try {
            const raw = JSON.parse(String(event.data))
            if (!authenticated) {
              authenticated = raw.type === 'server' && verifyServer(identity.serverFingerprint, identity.id, headers['x-lilbot-nonce'], raw)
              if (!authenticated) return socket?.close()
              delay = 500
              serverKey = raw.publicKey
              clearTimeout(timeout)
              sender.control('worker-capabilities', { type: 'worker.capabilities', agents: probe.current() })
              workers.onReconnect()
              sender.flush()
              return
            }
            if (!verifyFrame(serverKey, identity.id, headers['x-lilbot-nonce'], sequence++, raw)) return socket?.close()
            const frame = HelperWork.parse(JSON.parse(raw.payload))
            if (frame.type === 'heartbeat') {
              lastHeartbeat = Date.now()
              if (frame.challenge) {
                sender.heartbeat(frame.challenge)
                sender.flush()
              }
            } else if (frame.type === 'revoked') {
              revoked = true
              for (const controller of active.values()) controller.abort()
              workers.stopAll()
              socket?.close()
            } else if (frame.type === 'ack') {
              acknowledge(db, frame.id)
              sender.acknowledge(frame.id)
            } else if (frame.type === 'cancel') {
              active.get(frame.id)?.abort()
              if (!active.has(frame.id)) {
                db.query('INSERT OR IGNORE INTO requests(id,result,finished_at) VALUES(?,?,?)').run(frame.id, JSON.stringify({ output: '', error: 'Cancelled.' }), Date.now())
                const stored = db.query('SELECT result FROM requests WHERE id=?').get(frame.id) as { result: string }
                sender.receipt(frame.id, stored.result)
                sender.flush()
              }
            } else if (frame.type === 'work') void work(frame.id, frame.operation).catch(() => socket?.close())
            else workers.handle(frame)
          } catch {
            socket?.close()
          }
        }
        socket.onerror = () => socket?.close()
        socket.onclose = event => {
          if (event.code === 4001) delay = 30_000
          workers.onDisconnect()
          clearInterval(timer)
          clearTimeout(timeout)
          resolve()
        }
      })
      if (!signal.aborted && !revoked) await waitBackoff(delay + Math.random() * 250, signal)
      delay = Math.min(delay * 2, 30_000)
    }
    while (active.size || workers.activeCount()) await Bun.sleep(50)
    if (revoked) await (options.retire ?? retire)()
  } finally {
    signal.removeEventListener('abort', stop)
    db.close()
    lock.close()
  }
}
