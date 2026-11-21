import { expect, test } from 'bun:test'
import { endpointOf, serviceAddress, toolNames } from '../../server/connections/mcp-address'

test('a service address is HTTPS, or plain HTTP to this machine, with no credentials, fragment or secret in it', () => {
  for (const ok of [
    'https://mcp.notion.com/mcp',
    'https://api.githubcopilot.com/mcp/',
    'https://mcp.linear.app/sse',
    'http://127.0.0.1:4100/mcp',
    'http://localhost:9/x',
    'http://[::1]:9/x'
  ])
    expect(serviceAddress(ok).href).toBeTruthy()
  for (const bad of [
    'http://example.com/mcp',
    'ftp://example.com/mcp',
    'not an address',
    'https://user:pass@example.com/mcp',
    'https://example.com/mcp#x',
    'https://example.com/mcp?api_key=sk-live-0123456789abcdefghijklmnopqrstuv'
  ])
    expect(() => serviceAddress(bad)).toThrow()
})

test('a service on the internet may not point its sign-in at this machine; a local one may', () => {
  const remote = new URL('https://mcp.example.com/mcp')
  expect(endpointOf('https://auth.example.com/token', remote).href).toBe('https://auth.example.com/token')
  expect(() => endpointOf('http://127.0.0.1:8080/token', remote)).toThrow()
  expect(() => endpointOf(42, remote)).toThrow()
  expect(endpointOf('http://127.0.0.1:8080/token', new URL('http://127.0.0.1:9/mcp')).port).toBe('8080')
})

test('tool names an engine may be given: the MCP pattern only, without repeats, at most 200', () => {
  expect(toolNames([{ name: 'search' }, { name: 'search' }, { name: 'bad name' }, { name: '<script>' }, { name: 'a.b-c_d' }, {}, null])).toEqual(['search', 'a.b-c_d'])
  expect(toolNames(Array.from({ length: 300 }, (_, i) => ({ name: `t${i}` })))).toHaveLength(200)
  expect(toolNames('nope')).toEqual([])
})
