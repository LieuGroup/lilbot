/** One model's case in `check:prompt`: in a new session on that model, a normal answer and a real file tool call
 *  each carry exactly LilBot's prompt file on the wire, and so does a hidden routine session on the same model. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HermesEngine } from '../server/engines/hermes/hermes-engine'
import type { CapturedRequest } from './prompt-wire-proxy'
import { exact, stopOnAccountProblem } from './wire-verdicts'
import type { RestartServer } from './restart-server'

type Turn = (s: RestartServer, botId: string, chatId: string, text: string) => Promise<{ finished: any; reply: string; wire: CapturedRequest[] }>

export interface ModelCase {
  server: RestartServer
  engine: HermesEngine
  records: CapturedRequest[]
  turn: Turn
  check: (label: string, ok: boolean, detail?: string) => void
  bot: { id: string; workspace: string }
  nativeId: string
  promptPath: string
  spaceMs: number
}

export const answered = (finished: { type?: string; status?: string } | undefined) => finished?.type === 'turn.finished' && finished.status === 'completed'

export async function runModelCase(c: ModelCase, label: string, model: { provider: string; model: string }) {
  await c.server.call('bots.update', { botId: c.bot.id, model })
  const prompt = readFileSync(c.promptPath, 'utf8')
  const chat = await c.server.call('chat.new', { botId: c.bot.id })
  const plain = await c.turn(c.server, c.bot.id, chat.chatId, 'Reply with exactly: MODEL_OK')
  c.check(
    `${label}: a normal turn answers with the prompt file on the wire`,
    answered(plain.finished) && plain.reply.includes('MODEL_OK') && exact(plain.wire, prompt),
    `${plain.wire.length} request(s)`
  )

  const marker = `${label.toLowerCase().replace(/\W+/g, '-')}-${Date.now().toString(36)}`
  const from = c.server.events.length
  const tool = await c.turn(
    c.server,
    c.bot.id,
    chat.chatId,
    `Use your write_file tool to write "${marker}" to ${marker}.txt in your working directory, then reply with exactly: TOOL_OK`
  )
  const called = c.server.events.slice(from).filter(e => e.event === 'chat' && e.chatId === chat.chatId && e.data?.type === 'tool.started')
  const file = join(c.bot.workspace, `${marker}.txt`)
  c.check(
    `${label}: a real file tool call works with the prompt file on the wire`,
    answered(tool.finished) && called.length > 0 && existsSync(file) && readFileSync(file, 'utf8').includes(marker) && exact(tool.wire, prompt),
    `called=[${called.map(e => e.data.name).join(', ')}]`
  )

  await Bun.sleep(c.spaceMs)
  const routineFrom = c.records.length
  const run = await c.engine.runRoutine(c.nativeId, 'Reply with exactly: ROUTINE_OK', { runId: `prompt-${marker}`, workspace: c.bot.workspace, model, onChat: () => {} })
  stopOnAccountProblem(c.records, routineFrom)
  const wire = c.records.slice(routineFrom).filter(r => r.toolCount > 0)
  c.check(`${label}: a hidden routine session answers with the prompt file on the wire`, run.status === 'completed' && exact(wire, prompt))
}
