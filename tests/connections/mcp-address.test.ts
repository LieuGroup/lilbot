import { afterEach, expect, test } from 'bun:test'
import { endpointOf, serviceAddress, toolNames } from '../../server/connections/mcp-address'
import { boundedFetch, Unreachable } from '../../server/connections/mcp-http'
import { assertPublicAddress, isBlockedIp, setDnsLookup } from '../../server/connections/mcp-net'
import { ConnectionActionInput } from '../../shared/connections-schema'

afterEach(() => setDnsLookup())

test('a service address is HTTPS, or plain HTTP to this machine, with no credentials, fragment, private IP or secret in it', () => {
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
    'https://example.com/mcp?api_key=sk-live-0123456789abcdefghijklmnopqrstuv',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.1/mcp',
    'https://172.16.5.1/mcp',
    'https://192.168.1.1/mcp',
    'https://100.64.0.1/mcp',
    'https://0.0.0.0/mcp',
    'https://[::ffff:127.0.0.1]/mcp',
    'https://[fe80::1]/mcp',
    'https://[fc00::1]/mcp'
  ])
    expect(() => serviceAddress(bad)).toThrow()
})

test('a service on the internet may not point its sign-in at this machine; a local one may', () => {
  const remote = new URL('https://mcp.example.com/mcp')
  expect(endpointOf('https://auth.example.com/token', remote).href).toBe('https://auth.example.com/token')
  expect(() => endpointOf('http://127.0.0.1:8080/token', remote)).toThrow()
  expect(() => endpointOf('https://127.0.0.1:8080/token', remote)).toThrow()
  expect(() => endpointOf('https://localhost/token', remote)).toThrow()
  expect(() => endpointOf('https://[::1]/token', remote)).toThrow()
  expect(() => endpointOf(42, remote)).toThrow()
  expect(endpointOf('http://127.0.0.1:8080/token', new URL('http://127.0.0.1:9/mcp')).port).toBe('8080')
})

test('tool names an engine may be given: alphanumeric-start MCP pattern only, dropping lilbot_* spoofing (M4) and leading separators (L1), without repeats, at most 200', () => {
  expect(
    toolNames([
      { name: 'search' },
      { name: 'search' },
      { name: 'lilbot_work' },
      { name: 'LILBOT_connection' },
      { name: '_x' },
      { name: '.x' },
      { name: '-x' },
      { name: 'bad name' },
      { name: '<script>' },
      { name: 'a-b' },
      { name: 'a.b' },
      { name: 'a.b-c_d' },
      {},
      null
    ])
  ).toEqual(['search', 'a-b', 'a.b-c_d'])
  for (const bad of ['my__svc', 'ab_', 'a_', 'a', '_ab', '1ab'])
    expect(ConnectionActionInput.safeParse({ action: 'add', requestId: 'r1', name: bad, address: 'https://a.test/mcp' }).success).toBe(false)
  for (const ok of ['my_svc', 'ab', 'a_b', 'a1'])
    expect(ConnectionActionInput.safeParse({ action: 'add', requestId: 'r1', name: ok, address: 'https://a.test/mcp' }).success).toBe(true)
  expect(toolNames(Array.from({ length: 300 }, (_, i) => ({ name: `t${i}` })))).toHaveLength(200)
  expect(toolNames('nope')).toEqual([])
})

test('SSRF DNS guard blocks private, loopback, link-local, CGNAT, ULA, multicast and IPv4-mapped IPv6 addresses', async () => {
  for (const blocked of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1'
  ])
    expect(isBlockedIp(blocked)).toBe(true)
  for (const pub of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) expect(isBlockedIp(pub)).toBe(false)

  setDnsLookup(async () => [{ address: '169.254.169.254', family: 4 }])
  await expect(assertPublicAddress(new URL('https://rebind.example.com/mcp'))).rejects.toThrow('blocked')
  await expect(boundedFetch('https://rebind.example.com/mcp', { method: 'GET' })).rejects.toBeInstanceOf(Unreachable)
  // Dual-stack where one record is public and another is private is still refused.
  setDnsLookup(async () => [
    { address: '93.184.216.34', family: 4 },
    { address: 'fd00::1', family: 6 }
  ])
  await expect(assertPublicAddress(new URL('https://dual.example.com/mcp'))).rejects.toThrow('blocked')
  // Explicit loopback works when allowLoopback is true, refused when false.
  await expect(assertPublicAddress(new URL('http://127.0.0.1:4100/mcp'), true)).resolves.toBeUndefined()
  await expect(assertPublicAddress(new URL('http://127.0.0.1:4100/mcp'), false)).rejects.toThrow('blocked')
})
