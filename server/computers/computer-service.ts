import { homedir, hostname, platform } from 'node:os'
import { operate } from '../../helper/operations'
import { ComputerCopy, ComputerRequestRef, ComputerSubmit } from '../../shared/computer-schema'
import { ComputerAuth } from './computer-auth'
import type { ComputerStore } from './computer-store'
import type { ServerKey } from './server-key'
import { workspaceFile } from './workspace-file'

type Peer = { send: (frame: string) => unknown; close: (code?: number) => void; disconnect?: () => void; seen: number; sent: Set<string> }
export class ComputerService {
  readonly auth: ComputerAuth
  private peers = new Map<string, Peer>()
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
  connect(id: string, send: Peer['send'], close: Peer['close']) {
    if (this.peers.has(id)) {
      console.warn('[computers] concurrent connection replaced')
      this.peers.get(id)?.close(4001)
    }
    const peer: Peer = { send, close, seen: Date.now(), sent: new Set<string>() }
    this.peers.set(id, peer)
    this.store.seen(id)
    this.changed()
    this.dispatch(id)
    peer.disconnect = () => {
      if (this.peers.get(id) === peer) {
        this.peers.delete(id)
        this.changed()
      }
    }
    return peer.disconnect
  }
  isPeer(id: string, disconnect?: () => void) {
    return this.peers.get(id)?.disconnect === disconnect
  }
  heartbeat(id: string) {
    const peer = this.peers.get(id)
    if (peer) {
      peer.seen = Date.now()
      this.store.seen(id)
      peer.send(JSON.stringify({ type: 'heartbeat' }))
    }
  }
  tick() {
    this.store.prune()
    for (const [id, peer] of this.peers) {
      if (Date.now() - peer.seen > 35_000) {
        this.peers.delete(id)
        peer.close()
        this.changed()
      }
    }
    for (const computer of this.list()) if (computer.online) this.dispatch(computer.id)
  }
  remove(id: string) {
    if (id === 'leader') throw new Error('The leader cannot be removed.')
    for (const request of this.store.pending(id)) this.peers.get(id)?.send(JSON.stringify({ type: 'cancel', id: request.id }))
    this.store.revoke(id)
    this.peers.get(id)?.close()
    this.peers.delete(id)
    this.changed()
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
    const request = this.store.enqueue(bot, input.computer, input.requestId, input.operation)
    this.dispatch(input.computer)
    if (input.background) return request
    const until = Date.now() + 25_000
    while (Date.now() < until) {
      const latest = this.store.get(bot, input.computer, input.requestId)!
      if (!['pending', 'running'].includes(latest.status)) return latest
      if (!this.list().find(c => c.id === input.computer)?.online) throw new Error(`Computer offline. Request ${input.requestId} retained; read or cancel it explicitly.`)
      await Bun.sleep(100)
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
    this.store.result(computer, id, result, final)
    if (final) {
      const peer = this.peers.get(computer)
      peer?.sent.delete(id)
      peer?.sent.delete(`cancel:${id}`)
      peer?.send(JSON.stringify({ type: 'ack', id }))
    }
  }
  private dispatch(computer: string) {
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
      if (!peer || peer.sent.has(request.id)) continue
      if ([...peer.sent].filter(id => !id.startsWith('cancel:')).length >= 8) continue
      peer.sent.add(request.id)
      this.store.running(request.id)
      peer.send(JSON.stringify({ type: 'work', id: request.id, operation: this.store.operation(request.id) }))
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
      if (request.status !== 'completed' || !request.result) return request
      await file.write(request.result.output)
      return { ...request, result: { output: 'Copied to workspace.' } }
    })
  }
  close() {
    for (const peer of this.peers.values()) peer.close()
    for (const controller of this.local.values()) controller.abort()
  }
}
