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
    sends: ['source', 'request_id', 'client', 'cwd', 'cwd_explicit', 'hidden', 'yolo', 'ignore_rules', 'toolsets', 'model', 'provider', 'reasoning', 'client_env', 'editor'],
    reads: ['session_id', 'stored_session_id', 'running', 'execution_generation', 'revision', 'info', 'prompts', 'open_requests']
  },
  // Operations `model`, `reasoning`, plus helper worker ops `edit_policy` ({policy}), `editor_mcp` ({mcp_servers}) and `delete` ({}).
  'session.mutate': {
    table: 'x-canonical-methods',
    sends: ['session_id', 'request_id', 'expected_revision', 'expected_generation', 'operation', 'payload'],
    reads: ['session_id', 'operation', 'revision']
  },
  'session.transcript': { table: 'x-canonical-methods', sends: ['session_id', 'cursor', 'limit', 'order'], reads: ['rows', 'next_cursor', 'reset'] },
  // `enabled_toolsets`, `usage` and `tools.show`: what `check:webhooks` reads of a webhook run's session.
  'session.info': { table: 'x-canonical-methods', sends: ['session_id'], reads: ['system_prompt', 'enabled_toolsets', 'usage', 'context_length'] },
  'session.stats': {
    table: 'x-canonical-methods',
    sends: ['session_id'],
    reads: ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'context_tokens', 'last_prompt_tokens', 'context_length', 'compression_count']
  },
  'tools.show': { table: 'methods', sends: ['session_id'], reads: ['sections', 'total'] },
  'session.resume': {
    table: 'x-canonical-methods',
    sends: ['session_id', 'source', 'display_projection', 'omit_messages'],
    reads: ['session_id', 'stored_session_id', 'display_messages', 'messages', 'running', 'execution_generation', 'revision', 'info', 'prompts', 'open_requests']
  },
  'prompt.submit': {
    table: 'x-canonical-methods',
    sends: ['session_id', 'text', 'input_id', 'display_kind', 'queued', 'attachments', 'api_text'],
    reads: ['admission_id', 'execution_generation']
  },
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
  'approval.respond': { table: 'x-canonical-methods', sends: ['session_id', 'execution_generation', 'prompt_id', 'choice'], reads: ['status', 'prompt_id'] },
  'plugins.manage': { table: 'methods', sends: ['action', 'name', 'enable'], reads: ['ok', 'unchanged'] },
  'config.get': { table: 'methods', sends: ['key'], reads: ['value', 'config'] },
  'config.set': { table: 'methods', sends: ['key', 'value'], reads: ['value'] },
  // LilBot's MCP connections (T3 Code, the system server, the services bots add): `hermes-connections.ts`.
  'mcp.servers.list': { table: 'methods', sends: [], reads: ['servers'] },
  // Read by `bun run check:coding` to see a bot's T3 tools load.
  'mcp.servers.status': { table: 'methods', sends: [], reads: ['servers'] },
  'mcp.servers.remove': { table: 'methods', sends: ['name'], reads: [] },
  'mcp.servers.add': { table: 'methods', sends: ['name', 'config', 'bearer_token'], reads: [] },
  // With a live chat's `session_id` it commits the profile's servers to that chat in place (`session`: applied, unchanged or busy).
  'reload.mcp': { table: 'methods', sends: ['confirm', 'session_id'], reads: ['session', 'unavailable'] },
  'model.options': { table: 'methods', sends: [], reads: ['providers', 'model', 'provider'] }
}

const events: Record<string, string[]> = {
  'gateway.ready': [],
  'message.start': [],
  'message.interim': ['text'],
  'thinking.delta': ['text'],
  'message.delta': ['text'],
  'tool.start': ['tool_id', 'name', 'context', 'args'],
  'tool.complete': ['tool_id', 'result'],
  'message.complete': ['status', 'text', 'error', 'usage', 'persisted_turn'],
  'session.title': ['title'],
  'session.info': ['model', 'provider', 'reasoning_effort', 'reasoning_effort_wire', 'usage'],
  'session.usage': [
    'usage',
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
    'context_tokens',
    'last_prompt_tokens',
    'context_length',
    'compression_count'
  ],
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

  test('declared schemas keep every field LilBot and the helper driver read', () => {
    const schemas = contract.components.schemas
    const required: Record<string, string[]> = {
      CanonicalSessionListRow: ['session_id', 'id', 'resolved_id', 'source', 'running', 'started_at'],
      CanonicalReplayEvent: ['type', 'payload', 'seq'],
      CanonicalEventsResult: ['replay_epoch', 'last_sequence', 'open_requests', 'truncated'],
      McpServerRuntimeRow: ['name', 'connected', 'status'],
      ModelOptionProvider: ['slug', 'name', 'authenticated', 'models', 'capabilities'],
      ModelCapabilities: ['reasoning', 'can_disable_reasoning'],
      CanonicalSnapshotInfo: ['model', 'provider', 'reasoning_effort', 'reasoning_effort_wire', 'context_length', 'usage', 'source', 'launch_request'],
      CanonicalAttachment: ['path', 'mime'],
      StoredTranscriptRow: ['row_id', 'row_kind', 'timestamp', 'display_kind', 'role', 'text', 'tool_call_id', 'name', 'context', 'content', 'compacted_messages'],
      TranscriptMessage: ['role', 'text', 'tool_call_id', 'name', 'context', 'content', 'display_kind', 'timestamp'],
      Usage: ['input', 'output', 'cache_read', 'cache_write', 'context_used', 'context_max', 'compressions', 'calls'],
      PersistedTurn: ['final_assistant_row_id'],
      CanonicalPendingPrompt: ['kind', 'prompt_id', 'execution_generation', 'choices'],
      OpenRequestEntry: ['id', 'method', 'params']
    }
    for (const [name, used] of Object.entries(required)) expect(used.filter(k => !fields(schemas[name]).has(k))).toEqual([])
    expect(schemas.ReloadMcpSession.enum).toEqual(expect.arrayContaining(['applied', 'unchanged', 'busy']))
    expect(schemas.StoredTranscriptRow.properties?.row_kind?.enum ?? []).toContain('compaction')
    expect(schemas.TurnStatus?.enum ?? []).toEqual(expect.arrayContaining(['complete', 'error', 'interrupted']))
    expect(schemas.CanonicalCreateParams.properties.source.enum).toContain('acp')
    expect(schemas.CanonicalListParams.properties.scope.enum).toEqual(expect.arrayContaining(['live', 'stored']))
    expect(schemas.CanonicalCorrectionAck.properties.status.enum).toEqual(expect.arrayContaining(['queued', 'redirected']))
  })

  // Note: Hermes's gateway/session_pending_controls.py publishes live turn approvals as `approval.request`
  // notifications carrying the declared `CanonicalPendingPrompt` shape (answered via the declared `approval.respond`
  // method), even though OpenRPC `x-notifications` omits `approval.request` and only lists `x-server-requests: approval`.
  // The helper driver handles both paths so approvals settle under either gateway delivery path.
  test('helper Hermes worker driver server-requests (approval, clarify) remain declared', () => {
    const approvalReq = entry('x-server-requests', 'approval')
    expect(approvalReq).toBeDefined()
    expect(['session_id', 'request_id'].filter(k => !fields(approvalReq.params?.[0]?.schema).has(k))).toEqual([])
    expect(fields(approvalReq.result?.schema).has('choice')).toBe(true)
    const clarifyReq = entry('x-server-requests', 'clarify')
    expect(clarifyReq).toBeDefined()
    expect(['answers', 'outcome'].filter(k => !fields(clarifyReq.result?.schema).has(k))).toEqual([])
  })
})
