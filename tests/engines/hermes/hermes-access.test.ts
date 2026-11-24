import { expect, test } from 'bun:test'
import { hermesSessionEditor, hermesToolsetsForRun } from '../../../server/engines/hermes/hermes-access'

test('hermesToolsetsForRun maps review scope strictly to no_mcp and hermesSessionEditor builds the session-only MCP server payload', () => {
  expect(hermesToolsetsForRun('review')).toEqual(['no_mcp'])
  expect(hermesToolsetsForRun(undefined)).toBeUndefined()
  expect(hermesToolsetsForRun('check')).toEqual(['web', 'vision', 'terminal', 'file', 'skills', 'lilbot_system'])
  expect(hermesToolsetsForRun({ kind: 'webhook', capabilities: ['memory'] })).toEqual(['lilbot_system', 'memory'])
  expect(
    hermesSessionEditor({
      name: 'lilbot',
      url: 'http://127.0.0.1:4321/engine/lilbot/session/mcp?run=r1',
      bearerToken: 'secret-token',
      timeoutSeconds: 120,
      tools: ['lilbot_memory_recall']
    })
  ).toEqual({
    edit_approval_policy: 'ask',
    mcp_servers: [
      {
        type: 'http',
        name: 'lilbot',
        url: 'http://127.0.0.1:4321/engine/lilbot/session/mcp?run=r1',
        headers: [{ name: 'Authorization', value: 'Bearer secret-token' }]
      }
    ]
  })
})
