import { homedir, hostname, platform } from 'node:os'
import { operate } from '../../helper/operations'
import { ComputerCopy, ComputerRequestRef, ComputerSubmit } from '../../shared/computer-schema'
import { ComputerAuth } from './computer-auth'
import type { ComputerStore } from './computer-store'
import type { ServerKey } from './server-key'
import { payloadTurn } from './work-queue'
import { workspaceFile } from './workspace-file'

type Peer = { send: (frame: string) => unknown; ready?: () => boolean; pong?: string; close: (code?: number) => void; disconnect?: () => void; seen: number; sent: Set<string> }
export class ComputerService {
  readonly auth: ComputerAuth
  private closed = false
  private nextDispatch = new Map<string, number>()
  private dispatching = new Set<string>()
  private peers = new Map<string, Peer>()
  private contenders = new Map<string, { peer: Peer; challenge: string; until: number }>()
  private changeTimer?: ReturnType<typeof setTimeout>
  private notify() {
    if (!this.changeTimer)
      this.changeTimer = setTimeout(() => {
        this.changeTimer = undefined
        this.changed()
      }, 100)
  }
  private nextPrune = 0
  private local = new Map<string, AbortController>()
  constructor(
    readonly store: ComputerStore,
    serverKey: ServerKey,
    private botExists: (id: string) => boolean,
    private workspace: (id: string) => string,
    private changed = () => {},
    private permissionMode: (id: string) => string | undefined = () => undefined
  ) {
    this.auth = new ComputerAuth(store, serverKey)
    store.add('leader', { name: hostname(), os: platform(), home: homedir(), capabilities: ['exec', 'read', 'write', 'list', 'copy'] }, null)
  }
  list() {
    return this.store.list().map(c => ({ ...c, lastSeen: c.id === 'leader' ? Date.now() : c.lastSeen, online: c.id === 'leader' || this.peers.has(c.id) }))
  }
  connect(id: string, send: Peer['send'], close: Peer['close'], ready = () => true) {
    const peer: Peer = { send, close, ready, seen: Date.now(), sent: new Set<string>() }
    peer.disconnect = () => {
      if (this.peers.get(id) === peer) {
        this.peers.delete(id)
        this.notify()
      }
      if (this.contenders.get(id)?.peer === peer) this.contenders.delete(id)
    }
    if (this.store.list().find(c => c.id === id)?.keyConflict || this.contenders.has(id)) {
      close(4001)
      return () => {}
    }
    const existing = this.peers.get(id)
    if (existing) {
      const challenge = crypto.randomUUID()
      this.contenders.set(id, { peer, challenge, until: Date.now() + 3000 })
      existing.send(JSON.stringify({ type: 'heartbeat', challenge }))
      peer.send(JSON.stringify({ type: 'heartbeat', challenge }))
    } else {
      this.nextDispatch.delete(id)
      this.peers.set(id, peer)
      this.store.seen(id)
      this.notify()
      this.dispatch(id)
    }
    return peer.disconnect
  }
  isPeer(id: string, disconnect?: () => void) {
    return this.peers.get(id)?.disconnect === disconnect || this.contenders.get(id)?.peer.disconnect === disconnect
  }
  heartbeat(id: string, disconnect?: () => void, challenge?: string) {
    const peer = this.contenders.get(id)?.peer.disconnect === disconnect ? this.contenders.get(id)!.peer : this.peers.get(id)
    if (!peer) return
    peer.seen = Date.now()
    if (challenge) {
      if (this.contenders.get(id)?.challenge !== challenge || peer.pong === challenge) {
        peer.close(1008)
        return
      }
      peer.pong = challenge
    } else {
      this.store.seen(id)
      peer.send(JSON.stringify({ type: 'heartbeat' }))
    }
  }
  tick() {
    for (const [id, candidate] of this.contenders) {
      if (Date.now() < candidate.until) continue
      this.contenders.delete(id)
      const existing = this.peers.get(id)
      if (existing?.pong === candidate.challenge && candidate.peer.pong === candidate.challenge) {
        this.store.conflict(id, true)
        existing.close(4001)
        candidate.peer.close(4001)
        this.peers.delete(id)
      } else if (candidate.peer.pong === candidate.challenge) {
        existing?.close(4000)
        this.peers.set(id, candidate.peer)
      } else candidate.peer.close(4000)
      this.notify()
    }
    if (Date.now() >= this.nextPrune) {
      this.store.prune()
      this.nextPrune = Date.now() + 30_000
    }
    for (const [id, peer] of this.peers) {
      if (Date.now() - peer.seen > 35_000) {
        this.peers.delete(id)
        peer.close(4000)
        this.notify()
      }
    }
    for (const computer of this.list()) if (computer.online) this.dispatch(computer.id)
  }
  remove(id: string) {
    if (id === 'leader') throw new Error('The leader cannot be removed.')
    this.contenders.get(id)?.peer.send(JSON.stringify({ type: 'revoked' }))
    this.contenders.get(id)?.peer.close(4003)
    this.contenders.delete(id)
    this.peers.get(id)?.send(JSON.stringify({ type: 'revoked' }))
    this.store.revoke(id)
    this.peers.get(id)?.close(4003)
    this.peers.delete(id)
    this.notify()
    return { ok: true as const }
  }
  forgetBot(id: string) {
    this.store.forgetBot(id)
    this.tick()
  }
  private require(bot: string, computer: string) {
    if (!this.botExists(bot)) throw new Error('Unknown or deleted bot.')
    if (this.permissionMode(bot) !== 'full-access') throw new Error('Computer operations require full-access mode.')
    const found = this.list().find(c => c.id === computer)
    if (!found) throw new Error('Unknown or removed computer.')
    return found
  }
  async submit(bot: string, raw: unknown) {
    const input = ComputerSubmit.parse(raw)
    const computer = this.require(bot, input.computer)
    const old = this.store.get(bot, input.computer, input.requestId)
    if (!computer.online && !input.background && !old) throw new Error('Computer offline. Retry when online, or explicitly queue a background request.')
    if (!computer.capabilities.includes(input.operation.kind)) throw new Error('Computer does not support this operation.')
    const request = await payloadTurn(() => this.store.enqueue(bot, input.computer, input.requestId, input.operation, input.background))
    this.dispatch(input.computer)
    if (input.background) return request
    const until = Date.now() + 25_000
    while (Date.now() < until) {
      if (!['pending', 'running'].includes(this.store.status(request.id))) return this.store.get(bot, input.computer, input.requestId)!
      if (!this.list().find(c => c.id === input.computer)?.online) throw new Error(`Computer offline. Request ${input.requestId} retained; read or cancel it explicitly.`)
      await Bun.sleep(10)
    }
    return this.store.get(bot, input.computer, input.requestId)!
  }
  read(bot: string, raw: unknown) {
    const input = ComputerRequestRef.parse(raw)
    this.require(bot, input.computer)
    const request = this.store.get(bot, input.computer, input.requestId)
    if (!request) throw new Error('Unknown request.')
    return request
  }
  cancel(bot: string, raw: unknown) {
    const input = ComputerRequestRef.parse(raw)
    this.require(bot, input.computer)
    this.store.cancel(bot, input.computer, input.requestId)
    const request = this.read(bot, input)
    if (request.status === 'cancelled') {
      this.local.get(request.id)?.abort()
      this.peers.get(input.computer)?.send(JSON.stringify({ type: 'cancel', id: request.id }))
    }
    return request
  }
  result(computer: string, id: string, result: Parameters<ComputerStore['result']>[2], final: boolean) {
    if (this.contenders.has(computer) || this.store.list().find(c => c.id === computer)?.keyConflict) return
    this.store.result(computer, id, result, final)
    if (final) {
      const peer = this.peers.get(computer)
      peer?.sent.delete(id)
      peer?.sent.delete(`cancel:${id}`)
      peer?.send(JSON.stringify({ type: 'ack', id }))
    }
  }
  dispatch(computer: string) {
    if (computer === 'leader') return this.dispatchNow(computer)
    if (this.closed || this.dispatching.has(computer)) return
    this.dispatching.add(computer)
    void payloadTurn(() => this.dispatchNow(computer)).finally(() => this.dispatching.delete(computer))
  }
  private dispatchNow(computer: string) {
    if (this.closed) return
    if (computer !== 'leader' && Date.now() < (this.nextDispatch.get(computer) ?? 0)) return
    if (this.contenders.has(computer) || this.store.list().find(c => c.id === computer)?.keyConflict) return
    for (const request of this.store.pending(computer)) {
      if (request.status === 'cancelled') {
        this.local.get(request.id)?.abort()
        if (computer === 'leader' && !this.local.has(request.id)) this.store.result(computer, request.id, { output: '' }, true)
        const peer = this.peers.get(computer)
        if (peer && !peer.sent.has(`cancel:${request.id}`)) {
          peer.send(JSON.stringify({ type: 'cancel', id: request.id }))
          peer.sent.add(`cancel:${request.id}`)
        }
        continue
      }
      if (computer === 'leader') {
        if (this.local.size < 8) this.runLocal(request)
        continue
      }
      const peer = this.peers.get(computer)
      if (!peer?.ready?.() || peer.sent.has(request.id)) continue
      if ([...peer.sent].filter(id => !id.startsWith('cancel:')).length >= 8) continue
      this.nextDispatch.set(computer, Date.now() + 50)
      if (peer.send(`{"type":"work","id":${JSON.stringify(request.id)},"operation":${this.store.operationText(request.id)}}`) === false) break
      peer.sent.add(request.id)
      this.store.running(request.id)
      break // Drain or the next scheduler tick continues; bound each event-loop turn.
    }
  }
  private runLocal(request: { id: string; status: string }) {
    if (this.local.has(request.id)) return
    if (request.status === 'running') {
      this.store.result('leader', request.id, { output: '', error: 'Leader restarted; outcome unknown. Not re-executed.' }, true)
      return
    }
    const controller = new AbortController()
    this.local.set(request.id, controller)
    this.store.running(request.id)
    void operate(this.store.operation(request.id), controller.signal, result => this.store.result('leader', request.id, result, false))
      .then(result => this.store.result('leader', request.id, result, true))
      .catch(() => this.store.result('leader', request.id, { output: '', error: 'Operation failed.' }, true))
      .finally(() => this.local.delete(request.id))
  }
  async copy(bot: string, raw: unknown) {
    const input = ComputerCopy.parse(raw)
    this.require(bot, input.computer)
    return workspaceFile(this.workspace(bot), input.workspacePath, async file => {
      if (input.direction === 'fromWorkspace') {
        const data = await file.read()
        return this.submit(bot, { ...input, operation: { kind: 'write', path: input.path, data, encoding: 'base64' } })
      }
      const request = await this.submit(bot, { ...input, operation: { kind: 'read', path: input.path } })
      if (request.status !== 'completed' || !request.result || request.result.error) return request
      await file.write(request.result.output)
      return { ...request, result: { output: 'Copied to workspace.' } }
    })
  }
  close() {
    this.closed = true
    clearTimeout(this.changeTimer)
    for (const { peer } of this.contenders.values()) peer.close(1001)
    for (const peer of this.peers.values()) peer.close(1001)
    for (const controller of this.local.values()) controller.abort()
  }
}
