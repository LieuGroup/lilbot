/** Real-server WebSocket E2E test for iOS Work store: real `Bun.serve` + `BrowserSession` + SQLite `WorkService`/`WorkBoard`
 *  + real `LilBotSocket` + `createWorkStore`, proving every RPC, `status: 'failed'` filtering, and live `work.changed` pushes. */
import { describe, expect, test } from 'bun:test'
import { createWorkStore, type WorkSocket } from '../../ios/src/work/store-core'
import { BrowserSession } from '../../server/http/browser-session'
import { LilBotSocket } from '../../shared/client/socket'
import { failedCheckItems } from '../../shared/client/work/work-lines'
import type { EventFrame, ResponseFrame } from '../../shared/protocol'
import { fakeService } from '../helpers/fake-engine'
import { workFixture } from '../work/work-fixture'

const proof = { proves: 'build green', url: 'https://example.com/run/1' }

function startRealWorkWsServer() {
  const fake = fakeService()
  const f = workFixture()
  const sockets = new Set<{ send: (data: string) => void }>()
  const sessions = new WeakMap<object, BrowserSession>()

  const pushWorkChanged = () => {
    const payload = JSON.stringify({ event: 'work.changed' } satisfies EventFrame)
    for (const ws of sockets) ws.send(payload)
  }
  const origChanged = (f.work as unknown as { host: { changed: () => void } }).host.changed
  ;(f.work as unknown as { host: { changed: () => void } }).host.changed = () => {
    origChanged()
    pushWorkChanged()
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req, srv) {
      if (new URL(req.url).pathname === '/ws' && srv.upgrade(req)) return undefined
      return new Response('ok')
    },
    websocket: {
      open(ws) {
        sockets.add(ws)
        const session = new BrowserSession(
          fake.service,
          (frame: ResponseFrame | EventFrame) => ws.send(JSON.stringify(frame)),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          f.board
        )
        sessions.set(ws, session)
      },
      message(ws, message) {
        const session = sessions.get(ws)
        if (session) void session.handle(typeof message === 'string' ? message : new TextDecoder().decode(message))
      },
      close(ws) {
        sockets.delete(ws)
        sessions.get(ws)?.close()
      }
    }
  })

  return { server, f, url: `ws://127.0.0.1:${server.port}/ws` }
}

describe('iOS Work store end-to-end against real BrowserSession + WorkBoard + SQLite', () => {
  test('exercises work.brief, work.list (including failed), work.open, answer, pass, sendBack, drop, levels, and live work.changed pushes', async () => {
    const { server, f, url } = startRealWorkWsServer()
    const sock = new LilBotSocket({ url })
    const store = createWorkStore(() => sock as unknown as WorkSocket, { pushCoalesceMs: 10 })

    try {
      const opened = new Promise<void>(resolve => {
        const off = sock.onConnection(ok => {
          if (ok) {
            off()
            resolve()
          }
        })
      })
      sock.connect()
      await opened

      const qItem = await f.open('a', { title: 'Pick deploy region', kind: 'code' })
      await f.work.act('a', { requestId: 'q-ask', itemId: qItem.id, status: 'needs_oscar', question: 'Sydney or Tokyo?' })

      const l3Item = await f.open('a', { title: 'Approve TestFlight upload', kind: 'deploy', level: 3 })
      await f.work.act('a', { requestId: 'l3-done', itemId: l3Item.id, status: 'done', result: 'Build 42 uploaded', evidence: [proof] })

      const dropItem = await f.open('b', { title: 'Draft old benchmark', kind: 'note' })

      const failItem = await f.open('a', { title: 'Broken nightly check', kind: 'code', level: 2 })
      let releaseCheck!: () => void
      f.run.result = new Promise(r => {
        releaseCheck = () => r({ status: 'completed' })
      })
      await f.work.act('a', { requestId: 'f-done', itemId: failItem.id, status: 'done', result: 'Build ok', evidence: [proof] })
      f.checkRuns.tick()
      await Bun.sleep(5)
      f.state.chats.set('b', `check-${failItem.id}:check:1-session`)
      await f.work.act('b', { requestId: 'f-verdict', itemId: failItem.id, verdict: 'not_verified', result: 'Test failed', evidence: [proof] })
      f.state.chats.delete('b')
      releaseCheck()
      await f.work.act('a', { requestId: 'f-fail', itemId: failItem.id, status: 'failed', result: 'Compiler OOM' })

      const stopBadge = store.watchBadge()
      const stopBrief = store.watchBrief()
      const stopLevels = store.watchLevels()
      await Bun.sleep(60)

      expect(store.useStore.getState().badgeCount).toBe(2)
      expect(
        store.useStore
          .getState()
          .brief?.needsOscar.map(i => i.id)
          .sort()
      ).toEqual([l3Item.id, qItem.id].sort())
      expect(store.useStore.getState().brief?.failed.map(i => i.id)).toContain(failItem.id)
      expect(store.useStore.getState().active.map(i => i.id)).toContain(failItem.id)
      expect(failedCheckItems(store.useStore.getState().active, 0).map(i => i.id)).toContain(failItem.id)

      await store.loadItem(qItem.id)
      expect(store.useStore.getState().items[qItem.id]?.question).toBe('Sydney or Tokyo?')

      await store.answerWorkItem(qItem.id, 'Sydney')
      await Bun.sleep(60)
      expect(store.useStore.getState().badgeCount).toBe(1)
      expect(store.useStore.getState().items[qItem.id]?.status).toBe('working')

      await store.sendBackWorkItem(l3Item.id, 'Add release notes first')
      await Bun.sleep(60)
      expect(store.useStore.getState().badgeCount).toBe(0)
      expect(store.useStore.getState().items[l3Item.id]?.status).toBe('working')

      await f.work.act('a', { requestId: 'l3-done-2', itemId: l3Item.id, status: 'done', result: 'Release notes added', evidence: [proof] })
      await Bun.sleep(60)
      expect(store.useStore.getState().badgeCount).toBe(1)

      await store.passWorkItem(l3Item.id)
      await Bun.sleep(60)
      expect(store.useStore.getState().badgeCount).toBe(0)
      expect(store.useStore.getState().items[l3Item.id]?.status).toBe('done')

      await store.dropWorkItem(dropItem.id, 'Superseded by new benchmark')
      await Bun.sleep(60)
      expect(store.useStore.getState().items[dropItem.id]?.status).toBe('dropped')
      expect(store.useStore.getState().items[dropItem.id]?.dropReason).toBe('Superseded by new benchmark')

      await store.setWorkLevel('deploy', 3)
      await store.setWorkLevel('code', 2, 'a')
      await Bun.sleep(40)
      const levels = store.useStore.getState().levels
      expect(levels?.kinds.find(k => k.kind === 'deploy')?.level).toBe(3)
      expect(levels?.kinds.find(k => k.kind === 'code')?.bots).toEqual({ a: 2 })

      await store.setWorkLevel('code', null, 'a')
      await Bun.sleep(40)
      expect(store.useStore.getState().levels?.kinds.find(k => k.kind === 'code')?.bots).toEqual({})

      stopBadge()
      stopBrief()
      stopLevels()
    } finally {
      sock.stop()
      server.stop(true)
    }
  })
})
