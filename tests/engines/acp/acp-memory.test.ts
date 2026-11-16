import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { memoryRequest } from '../../../server/engines/acp/acp-memory'

test('memory transport binds bot and chat identity and keeps token out of the body', async () => {
  const directory = mkdtempSync('/home/oscar/agent-tmp/acp-memory-test-')
  const tokenFile = join(directory, 'token')
  writeFileSync(tokenFile, 'test-token')
  let body: unknown
  let auth: string | null = null
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      body = await request.json()
      auth = request.headers.get('authorization')
      return Response.json({ ok: true })
    }
  })
  try {
    const result = await memoryRequest({ url: `http://127.0.0.1:${server.port}`, tokenFile, botId: 'own', chatId: 'chat' }, 'recall', { botId: 'other', query: 'tea' })
    expect(result).toEqual({ ok: true })
    expect(body).toEqual({ botId: 'own', chatId: 'chat', query: 'tea' })
    expect(String(auth)).toBe('Bearer test-token')
  } finally {
    server.stop(true)
    rmSync(directory, { recursive: true, force: true })
  }
})
