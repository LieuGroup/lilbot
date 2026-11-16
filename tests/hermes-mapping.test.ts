import { describe, expect, test } from 'bun:test'

import { botDetailFromProfile, botFromProfile, profileIdFor, providersFromModelOptions } from '../server/engine/hermes/hermes-bot-mapping'
import { chatEventFrom, itemsFromRows, toolFailed } from '../server/engine/hermes/hermes-chat-mapping'

const event = (type: string, payload: Record<string, unknown> = {}) => ({ type, payload })

describe('chat events', () => {
  test('message.complete maps Hermes status to a turn result', () => {
    expect(chatEventFrom(event('message.complete', { status: 'complete', text: 'done' }))).toEqual({ type: 'turn.finished', status: 'completed', text: 'done' })
    expect(chatEventFrom(event('message.complete', { status: 'interrupted', text: 'par' }))).toEqual({ type: 'turn.finished', status: 'stopped', text: 'par' })
    expect(chatEventFrom(event('message.complete', { status: 'error', text: '' }))).toEqual({ type: 'turn.finished', status: 'failed', text: '' })
  })

  test('tool.complete reads failure from the tool result', () => {
    expect(chatEventFrom(event('tool.complete', { tool_id: 't', result: { exit_code: 0, output: 'ok' } }))).toEqual({ type: 'tool.finished', toolId: 't', failed: false })
    expect(chatEventFrom(event('tool.complete', { tool_id: 't', result: '{"exit_code": 2}' }))).toEqual({ type: 'tool.finished', toolId: 't', failed: true })
  })

  test('toolFailed follows the rules Hermes clients use', () => {
    expect(toolFailed({ success: false })).toBe(true)
    expect(toolFailed({ ok: false })).toBe(true)
    expect(toolFailed({ error: 'no such file' })).toBe(true)
    expect(toolFailed({ error: null, exit_code: 0 })).toBe(false)
    expect(toolFailed('plain text output')).toBe(false)
    expect(toolFailed(null)).toBe(false)
  })

  test('deltas with no text and unknown events are dropped', () => {
    expect(chatEventFrom(event('message.delta', { text: null }))).toBeNull()
    expect(chatEventFrom(event('thinking.delta', {}))).toBeNull()
    expect(chatEventFrom(event('platforms.changed'))).toBeNull()
  })

  test('tool.start carries the id, name and detail', () => {
    expect(chatEventFrom(event('tool.start', { tool_id: 't1', name: 'terminal', context: 'ls -la' }))).toEqual({
      type: 'tool.started',
      toolId: 't1',
      name: 'terminal',
      detail: 'ls -la'
    })
  })
})

test('stored rows become transcript items, skipping empty assistant rows', () => {
  const items = itemsFromRows([
    { role: 'user', text: 'run echo' },
    { role: 'assistant', text: '' },
    { role: 'tool', name: 'terminal', context: 'echo hi', tool_call_id: 'call-1' },
    { role: 'assistant', text: '**done**' },
    'garbage'
  ])
  expect(items).toEqual([
    { kind: 'user', text: 'run echo' },
    { kind: 'tool', toolId: 'call-1', name: 'terminal', detail: 'echo hi', running: false },
    { kind: 'assistant', text: '**done**' }
  ])
  expect(itemsFromRows(undefined)).toEqual([])
})

describe('bots', () => {
  test('the display name prefers LeBot’s own, then Hermes’ names, then the id', () => {
    const base = { name: 'researcher', description: 'Finds sources', is_default: false, skill_count: 3 }
    expect(botFromProfile({ ...base, display_name: 'Hermes Name', ui_meta: { lebot: { name: 'My Researcher' } } }).name).toBe('My Researcher')
    expect(botFromProfile({ ...base, display_name: 'Hermes Name' }).name).toBe('Hermes Name')
    expect(botFromProfile(base)).toEqual({ id: 'researcher', name: 'researcher', function: 'Finds sources', model: null, isDefault: false })
  })

  test('skills, toolsets and MCP servers become one neutral list of abilities', () => {
    const detail = botDetailFromProfile(botFromProfile({ name: 'r', description: 'd' }), {
      soul: 'Be brief.',
      toolsets: [{ name: 'web', label: 'Web search', enabled: true }],
      skills: [{ name: 'pdf', enabled: false }, 'garbage'],
      mcp_servers: [{ name: 'notion' }]
    })
    expect(detail.instructions).toBe('Be brief.')
    expect(detail.abilities).toEqual([
      { kind: 'toolset', id: 'web', label: 'Web search', enabled: true },
      { kind: 'skill', id: 'pdf', label: 'pdf', enabled: false },
      { kind: 'connector', id: 'notion', label: 'notion', enabled: true }
    ])
  })

  test('profile ids are lowercase, dash-separated and unique', () => {
    expect(profileIdFor('UI Check Bot!', new Set())).toBe('ui-check-bot')
    expect(profileIdFor('Researcher', new Set(['researcher', 'researcher-2']))).toBe('researcher-3')
    expect(profileIdFor('!!!', new Set())).toBe('bot')
    expect(profileIdFor('Đức', new Set())).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    expect(profileIdFor('x'.repeat(200), new Set()).length).toBeLessThanOrEqual(40)
  })

  test('only signed-in providers with models are offered', () => {
    const providers = providersFromModelOptions({
      providers: [
        { slug: 'a', name: 'A', authenticated: true, models: ['m1', 'm2'] },
        { slug: 'b', name: 'B', authenticated: false, models: ['m3'] },
        { slug: 'c', name: 'C', authenticated: true, models: [] }
      ]
    })
    expect(providers).toEqual([{ provider: 'a', name: 'A', models: ['m1', 'm2'] }])
  })
})
