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
  'session.create': {
    table: 'x-canonical-methods',
    sends: ['source', 'request_id', 'client', 'cwd', 'cwd_explicit'],
    reads: ['session_id', 'stored_session_id', 'running', 'execution_generation', 'info']
  },
  'session.resume': {
    table: 'x-canonical-methods',
    sends: ['session_id', 'source', 'display_projection'],
    reads: ['session_id', 'stored_session_id', 'display_messages', 'running', 'execution_generation', 'info']
  },
  'prompt.submit': { table: 'x-canonical-methods', sends: ['session_id', 'text', 'input_id'], reads: [] },
  'session.interrupt': { table: 'x-canonical-methods', sends: ['session_id', 'execution_generation'], reads: [] },
  'profiles.list': { table: 'methods', sends: ['include_sessions'], reads: ['profiles'] },
  'profiles.describe': { table: 'methods', sends: ['name'], reads: ['name', 'description', 'soul', 'model', 'skills', 'toolsets', 'mcp_servers'] },
  'profiles.create': { table: 'methods', sends: ['name', 'description', 'soul', 'no_alias', 'clone_from', 'model', 'provider'], reads: [] },
  'profiles.configure': { table: 'methods', sends: ['name', 'description', 'soul', 'model', 'provider', 'ui_meta'], reads: ['ok', 'confirm_required', 'confirm_message'] },
  'model.options': { table: 'methods', sends: [], reads: ['providers'] }
}

const events: Record<string, string[]> = {
  'gateway.ready': [],
  'message.start': [],
  'thinking.delta': ['text'],
  'message.delta': ['text'],
  'tool.start': ['tool_id', 'name', 'context'],
  'tool.complete': ['tool_id', 'result'],
  'message.complete': ['status', 'text', 'usage'],
  'session.title': ['title'],
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

  test('usage still reports the context size', () => {
    expect(Object.keys(contract.components.schemas.Usage?.properties ?? {})).toContain('context_used')
  })

  test('message.complete status still has the values LilBot maps', () => {
    const statuses: string[] = contract.components.schemas.TurnStatus?.enum ?? []
    for (const status of ['complete', 'error', 'interrupted']) expect(statuses).toContain(status)
  })
})
