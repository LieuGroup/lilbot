/** Run against an already-started, disposable ACP server on 3371. No real bots. */

import { strict as assert } from 'node:assert'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import type { ChatEvent, ChatSnapshot } from '../shared/chat-schema'

const socket = new WebSocket('ws://127.0.0.1:3371/ws', { headers: { origin: 'http://127.0.0.1:3371' } })
await new Promise<void>((resolve, reject) => {
  socket.onopen = () => resolve()
  socket.onerror = reject
})
let sequence = 0
const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
const events: ChatEvent[] = []
socket.onmessage = message => {
  const frame = JSON.parse(String(message.data))
  if (frame.event === 'chat') {
    events.push(frame.data)
    return
  }
  const waiter = waiting.get(frame.id)
  if (waiter) {
    waiting.delete(frame.id)
    frame.ok ? waiter.resolve(frame.result) : waiter.reject(new Error(frame.error.message))
  }
}
function request(method: string, params: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    waiting.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function until(test: () => boolean) {
  const start = Date.now()
  while (!test()) {
    if (Date.now() - start > 120_000) throw new Error('Timed out')
    await Bun.sleep(50)
  }
}
try {
  let botId = process.env.ACP_BOT_ID
  if (!botId) {
    const bot = await request('bots.create', { name: 'ACP temporary check', instructions: 'Be concise. Follow the user request.' })
    botId = bot.id
    console.log('bot', botId)
    await request('memory.write', { botId, kind: 'profile', scope: 'bot', text: 'The test user’s favourite constellation is Lyra.' })
  }
  const chat: ChatSnapshot = await request('chat.open', { botId })
  console.log('opened', JSON.stringify({ botId, chatId: chat.chatId, workspace: chat.workspace, itemCount: chat.items.length }))
  if (process.env.ACP_BOT_ID) {
    assert(chat.items.some(i => i.kind === 'assistant'))
    console.log('PASS restart replay')
  }
  const prompt = process.env.ACP_PROMPT ?? 'Reply with exactly: SPIKE_OK'
  const start = Date.now()
  await request('chat.send', { chatId: chat.chatId, text: prompt })
  if (process.env.ACP_CANCEL === '1') {
    await until(() => events.some(e => e.type === 'text.delta'))
    await request('chat.stop', { chatId: chat.chatId })
  }
  await until(() => events.some(e => e.type === 'turn.finished'))
  console.log('turn', JSON.stringify({ ms: Date.now() - start, events }))
  const finish = events.find(e => e.type === 'turn.finished')!
  assert(finish.type === 'turn.finished' && finish.status === (process.env.ACP_CANCEL ? 'stopped' : 'completed'))
  if (process.env.LILBOT_DATA_DIR) {
    const root = join(process.env.LILBOT_DATA_DIR, 'acp/codex/sessions')
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    for (const file of walk(root)) {
      if (!file.includes(chat.chatId)) continue
      const lines = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
      console.log('usage', JSON.stringify(lines.filter(row => row.type === 'event_msg' && row.payload.type === 'token_count').map(row => row.payload.info)))
    }
  }
} finally {
  socket.close()
}
