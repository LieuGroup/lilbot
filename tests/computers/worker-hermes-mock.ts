/** Reusable local loopback mock Hermes canonical WebSocket gateway for helper driver unit tests. */

export interface MockHermesBehavior {
  modelOptions?: Record<string, unknown>
  onOpen?: (ws: any) => void
  onSubmit?: (ws: any, params: Record<string, any>, reqs: { method: string; params: any }[]) => void
  onSteer?: (params: Record<string, any>) => { result?: any; error?: any }
  onInterrupt?: (ws: any, params: Record<string, any>) => void
  resumeDisplayMessages?: any[]
  resumeRunning?: boolean
  sessionInfoFor?: (sessionId: string) => Record<string, unknown>
  liveVisibleSessions?: Array<{ session_id: string; id?: string; resolved_id?: string; source?: string }>
  storedVisibleSessions?: Array<{ session_id: string; id?: string; resolved_id?: string; source?: string }>
  receipt?: Record<string, any>
}

export function startMockHermesGateway(behavior: MockHermesBehavior = {}, registerCleanup?: (fn: () => void) => void) {
  const requests: { method: string; params: any }[] = []
  const serverResponses: { id: string; result: any }[] = []
  let rev = 0
  let gen = 0
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined
      return new Response('ok')
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: {} } }))
        behavior.onOpen?.(ws)
      },
      message(ws, raw) {
        const frame = JSON.parse(String(raw))
        if (typeof frame.id === 'string' && !frame.method) {
          serverResponses.push({ id: frame.id, result: frame.result })
          return
        }
        const { id, method, params } = frame
        requests.push({ method, params })
        const reply = (result: any): void => {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }))
        }
        const fail = (reason: string, data: Record<string, unknown> = {}): void => {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 4001, message: reason, data: { reason, ...data } } }))
        }

        if (method === 'model.options') {
          return reply(
            behavior.modelOptions ?? { providers: [{ slug: 'cliproxyapi', authenticated: true, models: ['anthropic/claude-sonnet-5-5'] }], model: 'anthropic/claude-sonnet-5-5' }
          )
        }
        if (method === 'session.list') {
          const scope = params?.scope ?? 'live'
          // Mirrors real Hermes `gateway/session_listing.py`: `scope: 'stored'` never returns `source: 'acp'` sessions.
          const sessions = scope === 'stored' ? (behavior.storedVisibleSessions ?? []).filter(row => row.source !== 'acp') : (behavior.liveVisibleSessions ?? [])
          return reply({ sessions, scope })
        }
        if (method === 'session.create') {
          rev = 0
          gen = 0
          return reply({
            session_id: 'local-s1',
            stored_session_id: 'local-s1',
            revision: rev,
            execution_generation: gen,
            running: false,
            prompts: [],
            open_requests: [],
            info: { source: 'acp', launch_request: { source: 'acp', yolo: true, ignore_rules: true } }
          })
        }
        if (method === 'session.resume') {
          const info = behavior.sessionInfoFor?.(params.session_id) ?? {
            source: 'acp',
            launch_request: { source: 'acp', yolo: true, ignore_rules: true }
          }
          return reply({
            session_id: params.session_id,
            stored_session_id: params.session_id,
            revision: rev,
            execution_generation: gen,
            running: behavior.resumeRunning ?? false,
            display_messages: behavior.resumeDisplayMessages ?? [],
            prompts: [],
            open_requests: [],
            info
          })
        }
        if (method === 'session.stats') return reply({ input_tokens: 10, output_tokens: 5, context_length: 200_000 })
        if (method === 'session.mutate') {
          rev++
          return reply({ session_id: params.session_id, operation: params.operation, revision: rev })
        }
        if (method === 'approval.respond') return reply({ status: 'resolved', prompt_id: params.prompt_id })
        if (method === 'prompt.receipt') return reply(behavior.receipt ?? { status: 'terminal', outcome: 'completed' })
        if (method === 'session.steer') {
          const out = behavior.onSteer?.(params)
          if (out?.error) return fail(out.error.reason, out.error.data)
          return reply(out?.result ?? { status: 'queued', text: params.text, execution_generation: gen, authority_epoch: 1 })
        }
        if (method === 'session.interrupt') {
          behavior.onInterrupt?.(ws, params)
          return reply({ execution_state: 'interrupting' })
        }
        if (method === 'prompt.submit') {
          gen++
          reply({ admission_id: 'adm-1', status: 'started', execution_generation: gen })
          behavior.onSubmit?.(ws, params, requests)
          return
        }
        fail('unknown_method')
      }
    }
  })
  registerCleanup?.(() => server.stop(true))
  return { url: `ws://127.0.0.1:${server.port}/api/ws`, requests, serverResponses }
}
