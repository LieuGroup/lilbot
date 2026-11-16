import { expect, test } from 'bun:test'

import { allowedHosts, socketAllowed } from '../../server/http/socket-guard'

const hosts = allowedHosts(3370, 'My-Machine.example.ts.net:8443, ')
const request = (headers: Record<string, string>) => new Request('http://placeholder/ws', { headers })

test('local and listed hosts are allowed, with or without a matching Origin', () => {
  expect(socketAllowed(request({ host: '127.0.0.1:3370' }), hosts)).toBe(true)
  expect(socketAllowed(request({ host: 'localhost:3370', origin: 'http://localhost:3370' }), hosts)).toBe(true)
  expect(socketAllowed(request({ host: 'my-machine.example.ts.net:8443', origin: 'https://my-machine.example.ts.net:8443' }), hosts)).toBe(true)
})

test('another site cannot use the socket through the user’s browser', () => {
  expect(socketAllowed(request({ host: '127.0.0.1:3370', origin: 'https://evil.example' }), hosts)).toBe(false)
  expect(socketAllowed(request({ host: '127.0.0.1:3370', origin: 'not a url' }), hosts)).toBe(false)
})

test('a domain pointed at this machine (DNS rebinding) is refused even when Origin matches Host', () => {
  expect(socketAllowed(request({ host: 'evil.example:3370', origin: 'http://evil.example:3370' }), hosts)).toBe(false)
  expect(socketAllowed(request({ host: '127.0.0.1:9999' }), hosts)).toBe(false)
  expect(socketAllowed(request({}), hosts)).toBe(false)
})
