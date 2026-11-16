import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

test('MCP recall, write and forget use the bound bot and chat', async () => {
  const directory = mkdtempSync('/home/oscar/agent-tmp/acp-mcp-test-')
  const seen: { path: string; body: any }[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      expect(request.headers.get('authorization')).toBe('Bearer fake-token')
      seen.push({ path: new URL(request.url).pathname, body: await request.json() })
      return Response.json({ ok: true })
    }
  })
  writeFileSync(join(directory, 'token'), 'fake-token')
  writeFileSync(
    join(directory, 'binding.json'),
    JSON.stringify({ url: `http://127.0.0.1:${server.port}`, tokenFile: join(directory, 'token'), botId: 'own-bot', chatId: 'own-chat' })
  )
  const transport = new StdioClientTransport({
    command: Bun.which('bun')!,
    args: [join(import.meta.dir, '../../../server/engines/acp/acp-memory-mcp.ts'), join(directory, 'binding.json')],
    stderr: 'ignore'
  })
  const client = new Client({ name: 'test', version: '1' })
  try {
    await client.connect(transport)
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(['recall_memory', 'update_memory'])
    await client.callTool({ name: 'recall_memory', arguments: { query: 'constellation' } })
    await client.callTool({ name: 'update_memory', arguments: { action: 'write', kind: 'profile', text: 'A fact.' } })
    await client.callTool({ name: 'update_memory', arguments: { action: 'forget', id: '1234' } })
    expect(seen.map(r => r.path)).toEqual(['/engine/memory/recall', '/engine/memory/write', '/engine/memory/forget'])
    expect(seen.every(r => r.body.botId === 'own-bot' && r.body.chatId === 'own-chat')).toBe(true)
  } finally {
    await client.close()
    server.stop(true)
    rmSync(directory, { recursive: true, force: true })
  }
})
