/** Hermes worker driver for the helper over Hermes's canonical gateway WebSocket.
 *  Attaches unmanaged (`--start` / `--idle-exit`), holds per-run MCP tools in gateway RAM only (`editor.mcp_servers`),
 *  auto-approves prompts for full-access workers, prunes 7-day-old hidden worker sessions, and never edits `config.yaml`. */
import type { Database } from 'bun:sqlite'
import { existsSync, statSync } from 'node:fs'
import { SAFE_WORKER_SESSION_ID, WORKER_SYSTEM_PROMPT_MAX_BYTES } from '../shared/worker-frame-schema'
import { extractSafeVersion, runProbeCommand } from './worker-bin'
import type { WorkerDriver, WorkerHandle, WorkerOutcome } from './worker-driver'
import { attachToHermesGateway, detectHermesSignedIn, type HermesGrant, resolveAttachTarget, resolveHermesBinary, resolveHermesHome } from './worker-hermes-env'
import { cleanHermesError } from './worker-hermes-model'
import { applyHermesEvent, createHermesStreamState, mapHermesTranscript } from './worker-hermes-protocol'
import { pruneOldHermesSessions } from './worker-hermes-prune'
import { approvePrompt, approveSnapshotPrompts, openHermesSession, steerHermesSession } from './worker-hermes-session'
import { type HermesGatewayEvent, type HermesServerRequest, HermesWorkerSocket } from './worker-hermes-socket'
import { expandWorkerCwd } from './worker-text'

export interface HermesDriverOptions {
  bin?: string
  hermesHome?: string
  lockDir?: string
  configDir?: string
  pathEnv?: string
  env?: Record<string, string | undefined>
  db?: Database
  stopGraceMs?: number
  attachTimeoutSec?: number
  attach?: () => Promise<HermesGrant>
  createWebSocket?: (url: string, protocols: string[]) => WebSocket
}

const failedHandle = (error: string): WorkerHandle => ({
  steer: async () => 'not_running',
  stop: () => {},
  done: Promise.resolve({ status: 'failed', text: '', items: [], error })
})

export function hermesDriver(options: HermesDriverOptions = {}): WorkerDriver {
  const stopGraceMs = options.stopGraceMs ?? 3000
  return {
    id: 'hermes',
    async detect() {
      const bin = resolveHermesBinary(options.bin, options.pathEnv)
      if (!bin) return null
      let res = await runProbeCommand(bin, ['acp', '--version'], 3000)
      if (res?.code !== 0) res = await runProbeCommand(bin, ['--version'], 2500)
      if (res?.code !== 0) return null
      const env = options.env ?? process.env
      const signedIn = detectHermesSignedIn(resolveHermesHome(options.hermesHome, env), env)
      return { driver: 'hermes', version: extractSafeVersion(res.stdout), supported: true, ...(signedIn !== undefined ? { signedIn } : {}) }
    },
    start(request, onEvent): WorkerHandle {
      const secret = request.mcp?.token
      const cwd = expandWorkerCwd(request.cwd)
      const bin = options.attach ? 'hermes' : resolveHermesBinary(options.bin, options.pathEnv)
      if (!bin) return failedHandle('Hermes is not installed on this computer.')
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return failedHandle('Working directory does not exist.')
      if (request.sessionId && !SAFE_WORKER_SESSION_ID.test(request.sessionId)) return failedHandle('Invalid Hermes session id.')
      if (request.systemPrompt && Buffer.byteLength(request.systemPrompt, 'utf8') > WORKER_SYSTEM_PROMPT_MAX_BYTES) return failedHandle('System prompt exceeds byte limit.')

      const state = createHermesStreamState(request.sessionId)
      let socket: HermesWorkerSocket | undefined
      let liveSessionId: string | undefined
      let storedSessionId: string | undefined = request.sessionId
      let generation = 0
      let admissionId: string | undefined
      let stopped = false
      let finished = false
      let stopTimer: ReturnType<typeof setTimeout> | undefined
      let settleTurn: ((kind: 'event' | 'closed' | 'stop_timeout') => void) | undefined

      const onGatewayEvent = (sock: HermesWorkerSocket, ev: HermesGatewayEvent) => {
        if (liveSessionId && ev.sessionId && ev.sessionId !== liveSessionId && ev.sessionId !== storedSessionId) return
        if (typeof ev.executionGeneration === 'number' && ev.executionGeneration >= generation) generation = ev.executionGeneration
        if (ev.type === 'approval.request' && typeof ev.payload.prompt_id === 'string' && liveSessionId) {
          approvePrompt(sock, liveSessionId, ev.payload.prompt_id, typeof ev.payload.execution_generation === 'number' ? ev.payload.execution_generation : generation)
          return
        }
        const progress = applyHermesEvent(state, ev, secret)
        if (progress) onEvent(progress)
        if (state.complete) settleTurn?.('event')
      }
      const onServerRequest = (sock: HermesWorkerSocket, req: HermesServerRequest) => {
        if (liveSessionId && req.params.session_id && req.params.session_id !== liveSessionId && req.params.session_id !== storedSessionId) return
        if (req.method === 'approval') sock.respond(req.id, { choice: 'once' })
        else if (req.method === 'clarify') sock.respond(req.id, { answers: null, outcome: 'cancelled' })
      }
      const dial = async () => {
        const env = options.env ?? process.env
        const grant = options.attach
          ? await options.attach()
          : await attachToHermesGateway(bin, resolveAttachTarget(resolveHermesHome(options.hermesHome, env), options.configDir, options.lockDir), {
              timeoutSec: options.attachTimeoutSec,
              env
            })
        let s!: HermesWorkerSocket
        s = await HermesWorkerSocket.connect(grant, {
          onEvent: ev => onGatewayEvent(s, ev),
          onServerRequest: req => onServerRequest(s, req),
          onClose: () => settleTurn?.('closed'),
          createWebSocket: options.createWebSocket
        })
        return s
      }
      const waitTurn = () =>
        new Promise<'event' | 'closed' | 'stop_timeout'>(resolve => {
          if (state.complete) return resolve('event')
          settleTurn = r => {
            settleTurn = undefined
            resolve(r)
          }
        })

      const stop = () => {
        if (stopped || finished) return
        stopped = true
        if (socket?.isOpen && liveSessionId) void socket.request('session.interrupt', { session_id: liveSessionId, execution_generation: generation }).catch(() => {})
        stopTimer = setTimeout(() => settleTurn?.('stop_timeout'), stopGraceMs)
      }

      const done: Promise<WorkerOutcome> = (async () => {
        let baselineMessages = 0
        let fallbackNote: string | undefined
        try {
          socket = await dial()
          if (stopped) return { ...(storedSessionId ? { sessionId: storedSessionId } : {}), status: 'stopped', text: '', items: [] }

          const opened = await openHermesSession(socket, request, cwd, state)
          if (!opened.ok) return { status: 'failed', text: '', items: [], error: opened.error }
          ;({ liveSessionId, storedSessionId, generation, baselineMessages, fallbackNote } = opened.session)
          state.sessionId = storedSessionId
          onEvent({ sessionId: storedSessionId, ...(fallbackNote ? { activity: fallbackNote } : {}) })
          if (stopped) return { sessionId: storedSessionId, status: 'stopped', text: '', items: [] }

          const submit = await socket.request('prompt.submit', { session_id: liveSessionId, input_id: `worker-${request.runId}`, text: request.prompt })
          admissionId = typeof submit?.admission_id === 'string' ? submit.admission_id : undefined
          if (typeof submit?.execution_generation === 'number') generation = submit.execution_generation
          if (stopped) void socket.request('session.interrupt', { session_id: liveSessionId, execution_generation: generation }).catch(() => {})

          const reason = await waitTurn()
          if (reason === 'closed' && !state.complete && !stopped && storedSessionId) {
            try {
              socket = await dial()
              const res = await socket.request('session.resume', { session_id: storedSessionId, source: 'acp', display_projection: true })
              liveSessionId = String(res.session_id)
              if (typeof res.execution_generation === 'number') generation = res.execution_generation
              approveSnapshotPrompts(socket, res, liveSessionId, generation)
              const receipt = admissionId ? await socket.request('prompt.receipt', { session_id: storedSessionId, admission_id: admissionId }).catch(() => null) : null
              if (receipt?.status === 'terminal' || res.running === false) {
                const ok = receipt?.outcome === 'completed' || !receipt
                state.complete = { status: ok ? 'completed' : receipt?.outcome === 'interrupted' ? 'stopped' : 'failed', text: state.text }
              } else await waitTurn()
            } catch {}
          }

          let finalItems = state.items
          for (const item of state.tools.values()) item.running = false
          if (socket?.isOpen && storedSessionId) {
            const finalSnap = await socket.request('session.resume', { session_id: storedSessionId, source: 'acp', display_projection: true }, 15_000).catch(() => null)
            const mapped = finalSnap ? mapHermesTranscript(finalSnap.display_messages, baselineMessages, secret) : []
            if (mapped.length) finalItems = mapped
            await pruneOldHermesSessions(socket, options.db, { excludeSessionId: storedSessionId }).catch(() => {})
          }
          const baseText =
            state.complete?.text ||
            finalItems
              .filter(i => i.kind === 'assistant')
              .map(i => i.text)
              .join('\n\n') ||
            state.text
          const session = storedSessionId ? { sessionId: storedSessionId } : {}
          if (stopped || state.complete?.status === 'stopped') return { ...session, status: 'stopped', text: baseText, items: finalItems, usage: state.usage }
          if (!state.complete) return { ...session, status: 'interrupted', text: baseText, items: finalItems, usage: state.usage, error: 'Connection to Hermes gateway was lost.' }
          if (state.complete.status === 'failed')
            return { ...session, status: 'failed', text: '', items: finalItems, usage: state.usage, error: state.complete.error ?? 'Hermes worker failed.' }
          const text = fallbackNote ? `[${fallbackNote}]${baseText ? `\n\n${baseText}` : ''}` : baseText
          return { ...session, status: 'completed', text, items: finalItems, usage: state.usage }
        } catch (error) {
          const msg = cleanHermesError(error instanceof Error ? error.message : 'Hermes worker failed.', secret)
          return { ...(storedSessionId ? { sessionId: storedSessionId } : {}), status: stopped ? 'stopped' : 'failed', text: '', items: state.items, error: msg }
        } finally {
          finished = true
          if (stopTimer) clearTimeout(stopTimer)
          socket?.close()
        }
      })()

      return {
        steer: text =>
          stopped || finished || !socket?.isOpen || !liveSessionId
            ? Promise.resolve('not_running')
            : steerHermesSession(socket, liveSessionId, storedSessionId, generation, text, next => {
                generation = next
              }),
        stop,
        done
      }
    }
  }
}
