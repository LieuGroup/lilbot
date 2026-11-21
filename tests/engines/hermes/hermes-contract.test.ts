/** Checks that the installed Hermes still offers every method, parameter, result field and event
 *  field LilBot relies on, by reading Hermes' own wire contract. A Hermes update that removes or
 *  renames one of them fails here instead of in front of the user.
 *
 *  Session methods are checked against Hermes' canonical table (the form LilBot sends); profile and
 *  model methods exist only in the general table. Skipped when Hermes is not installed. */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONTRACT = process.env.HERMES_CONTRACT ?? join(homedir(), '.hermes/hermes-agent/apps/shared/src/gateway-contract.openrpc.json')
const installed = existsSync(CONTRACT)
const contract: any = installed ? JSON.parse(readFileSync(CONTRACT, 'utf8')) : {}

/** All property names a schema declares, following references and combined schemas. */
function fields(schema: any, seen = new Set<string>()): Set<string> {
  const out = new Set<string>()
  if (!schema || typeof schema !== 'object') return out
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.split('/').pop() as string
    if (seen.has(name)) return out
    seen.add(name)
    return fields(contract.components?.schemas?.[name], seen)
  }
  for (const key of Object.keys(schema.properties ?? {})) out.add(key)
  for (const part of [...(schema.allOf ?? []), ...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) for (const key of fields(part, seen)) out.add(key)
  return out
}

const entry = (table: string, name: string) => (contract[table] as any[] | undefined)?.find(item => item.name === name)

interface Uses {
  table: 'x-canonical-methods' | 'methods'
  sends: string[]
  reads: string[]
}

const methods: Record<string, Uses> = {
  'session.list': { table: 'x-canonical-methods', sends: ['scope', 'limit', 'include_hidden'], reads: ['sessions'] },
  'session.events.since': {
    table: 'x-canonical-methods',
    sends: ['session_id', 'last_sequence', 'replay_epoch'],
    reads: ['events', 'replay_epoch', 'last_sequence', 'open_requests', 'truncated']
  },
  'session.create': {
    table: 'x-canonical-methods',
    sends: ['source', 'request_id', 'client', 'cwd', 'cwd_explicit', 'hidden', 'yolo', 'toolsets', 'model', 'provider', 'reasoning'],
    reads: ['session_id', 'stored_session_id', 'running', 'execution_generation', 'info']
  },
  // Operations `model` ({model, provider, reasoning}) and `reasoning` ({effort}); their payloads are not in the schema, so `check:reasoning` exercises both.
  'session.mutate': { table: 'x-canonical-methods', sends: ['session_id', 'request_id', 'expected_revision', 'expected_generation', 'operation', 'payload'], reads: ['revision'] },
  'session.transcript': { table: 'x-canonical-methods', sends: ['session_id', 'cursor', 'limit', 'order'], reads: ['rows', 'next_cursor', 'reset'] },
  // `enabled_toolsets`, `usage` and `tools.show`: what `check:webhooks` reads of a webhook run's session.
  'session.info': { table: 'x-canonical-methods', sends: ['session_id'], reads: ['system_prompt', 'enabled_toolsets', 'usage'] },
  'tools.show': { table: 'methods', sends: ['session_id'], reads: ['sections', 'total'] },
  'session.resume': {
    table: 'x-canonical-methods',
    sends: ['session_id', 'source', 'display_projection', 'omit_messages'],
    reads: ['session_id', 'stored_session_id', 'display_messages', 'messages', 'running', 'execution_generation', 'revision', 'info']
  },
  'prompt.submit': { table: 'x-canonical-methods', sends: ['session_id', 'text', 'input_id', 'display_kind', 'queued', 'attachments', 'api_text'], reads: ['admission_id'] },
  'image.attach_bytes': { table: 'x-canonical-methods', sends: ['session_id', 'content_base64'], reads: ['attached', 'path', 'mime'] },
  'prompt.receipt': { table: 'x-canonical-methods', sends: ['session_id', 'admission_id'], reads: ['status', 'outcome'] },
  'session.interrupt': { table: 'x-canonical-methods', sends: ['session_id', 'execution_generation'], reads: [] },
  // Redirecting a delegated task: `hermes-run-control.ts`.
  'session.steer': { table: 'x-canonical-methods', sends: ['session_id', 'execution_generation', 'text'], reads: ['status'] },
  'profiles.list': { table: 'methods', sends: ['include_sessions'], reads: ['profiles'] },
  'profiles.describe': { table: 'methods', sends: ['name'], reads: ['name', 'description', 'soul', 'model', 'skills', 'toolsets', 'mcp_servers'] },
  'profiles.create': { table: 'methods', sends: ['name', 'description', 'soul', 'no_alias', 'clone_from', 'model', 'provider'], reads: [] },
  'profiles.configure': { table: 'methods', sends: ['name', 'description', 'soul', 'model', 'provider'], reads: ['ok', 'confirm_required', 'confirm_message'] },
  'approval.pending': { table: 'methods', sends: ['session_id'], reads: ['approvals'] },
  'plugins.manage': { table: 'methods', sends: ['action', 'name', 'enable'], reads: ['ok', 'unchanged'] },
  'config.get': { table: 'methods', sends: ['key'], reads: ['value'] },
  'config.set': { table: 'methods', sends: ['key', 'value'], reads: ['value'] },
  // LilBot's own MCP connections (T3 Code through LilBot's bridge): `hermes-connections.ts`.
  'mcp.servers.list': { table: 'methods', sends: [], reads: ['servers'] },
  // Read by `bun run check:coding` to see a bot's T3 tools load.
  'mcp.servers.status': { table: 'methods', sends: [], reads: ['servers'] },
  'mcp.servers.remove': { table: 'methods', sends: ['name'], reads: [] },
  'mcp.servers.add': { table: 'methods', sends: ['name', 'config', 'bearer_token'], reads: [] },
  'reload.mcp': { table: 'methods', sends: ['confirm'], reads: [] },
  'model.options': { table: 'methods', sends: [], reads: ['providers'] }
}

const events: Record<string, string[]> = {
  'gateway.ready': [],
  'message.start': [],
  'message.interim': ['text'],
  'thinking.delta': ['text'],
  'message.delta': ['text'],
  'tool.start': ['tool_id', 'name', 'context', 'args'],
  'tool.complete': ['tool_id', 'result'],
  'message.complete': ['status', 'text', 'usage'],
  'session.title': ['title'],
  'session.info': ['model', 'provider', 'reasoning_effort', 'reasoning_effort_wire'],
  error: ['message'],
  'session.reclaimed': []
}

describe.skipIf(!installed)('Hermes wire contract', () => {
  for (const [name, uses] of Object.entries(methods)) {
    test(`${name}: exists with the params LilBot sends and the result fields it reads`, () => {
      const method = entry(uses.table, name)
      expect(method, `${name} is missing from ${uses.table}`).toBeDefined()
      const params = fields(method.params?.[0]?.schema)
      const result = fields(method.result?.schema)
      expect(uses.sends.filter(field => !params.has(field))).toEqual([])
      expect(uses.reads.filter(field => !result.has(field))).toEqual([])
    })
  }

  for (const [name, reads] of Object.entries(events)) {
    test(`event ${name}: exists with the fields LilBot reads`, () => {
      const event = entry('x-notifications', name)
      expect(event, `event ${name} is missing`).toBeDefined()
      const payload = fields(event.params?.[0]?.schema)
      expect(reads.filter(field => !payload.has(field))).toEqual([])
    })
  }

  test('activity replay and list fields are declared', () => {
    for (const [name, used] of Object.entries({
      CanonicalSessionListRow: ['session_id', 'id', 'source', 'running', 'started_at'],
      CanonicalReplayEvent: ['type', 'payload', 'seq'],
      CanonicalEventsResult: ['replay_epoch', 'last_sequence', 'open_requests', 'truncated']
    })) {
      expect(used.filter(key => !fields(contract.components.schemas[name]).has(key))).toEqual([])
    }
  })

  test('model inventory declares the provider fields used for validation and the per-model capabilities', () => {
    const schemas = contract.components.schemas
    expect(['slug', 'name', 'authenticated', 'models', 'capabilities'].filter(key => !fields(schemas.ModelOptionProvider).has(key))).toEqual([])
    expect(['reasoning', 'can_disable_reasoning'].filter(key => !fields(schemas.ModelCapabilities).has(key))).toEqual([])
  })

  test('a session reports the effort it chose and the one it really sends', () => {
    const info = fields(contract.components.schemas.CanonicalSnapshotInfo)
    expect(['model', 'provider', 'reasoning_effort', 'reasoning_effort_wire'].filter(key => !info.has(key))).toEqual([])
  })

  test('attachment input fields remain declared', () => {
    expect(['path', 'mime'].filter(key => !fields(contract.components.schemas.CanonicalAttachment).has(key))).toEqual([])
  })

  test('history transcript fields remain declared', () => {
    expect(
      ['row_id', 'row_kind', 'timestamp', 'display_kind', 'role', 'text', 'tool_call_id', 'name', 'context', 'content'].filter(
        key => !fields(contract.components.schemas.StoredTranscriptRow).has(key)
      )
    ).toEqual([])
  })

  test('thread transcript fields remain declared', () => {
    expect(['role', 'text', 'tool_call_id', 'name', 'context', 'content'].filter(key => !fields(contract.components.schemas.TranscriptMessage).has(key))).toEqual([])
  })

  test('usage still reports the context size', () => {
    expect(Object.keys(contract.components.schemas.Usage?.properties ?? {})).toContain('context_used')
  })

  test('message.complete status still has the values LilBot maps', () => {
    const statuses: string[] = contract.components.schemas.TurnStatus?.enum ?? []
    for (const status of ['complete', 'error', 'interrupted']) expect(statuses).toContain(status)
  })
})
