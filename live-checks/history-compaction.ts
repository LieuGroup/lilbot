/** End-to-end dev check for #180: real per-turn cache/token usage, bot context against window,
 *  and a real Hermes compaction marker in LilBot's history. Called by `live-checks/history-check.ts`. */
import assert from 'node:assert/strict'
import type { RestartServer } from './restart-server'
import { waitFor } from './restart-server'

function passage(seed: number, chars = 100_000) {
  const words = 'the river ran past an old mill while slow clouds drifted over quiet fields and a cart rolled along the stony road toward hills'.split(' ')
  let state = seed * 100_003 + 17
  let out = ''
  while (out.length < chars) {
    state = (state * 48_271) % 2_147_483_647
    out += `${words[state % words.length]} `
  }
  return out
}

export function assertTurnUsage(done: any, label: string) {
  assert.ok(done?.usage, `${label}: turn.finished missing usage (${JSON.stringify(done)})`)
  assert.ok(typeof done.usage.outputTokens === 'number' && done.usage.outputTokens > 0, `${label}: missing outputTokens (${JSON.stringify(done.usage)})`)
  assert.ok(typeof done.usage.contextTokens === 'number' && done.usage.contextTokens > 0, `${label}: missing contextTokens (${JSON.stringify(done.usage)})`)
  assert.ok(typeof done.usage.contextWindow === 'number' && done.usage.contextWindow > 0, `${label}: missing contextWindow (${JSON.stringify(done.usage)})`)
  const promptTotal = (done.usage.inputTokens ?? 0) + (done.usage.cacheReadTokens ?? 0) + (done.usage.cacheWriteTokens ?? 0)
  assert.ok(promptTotal > 0, `${label}: missing prompt token breakdown (${JSON.stringify(done.usage)})`)
}

export async function assertBotContext(server: RestartServer, botId: string, expectUsed: 'positive' | 'zero') {
  const list = await server.call('bots.list')
  const listed = list.find((b: any) => b.id === botId)
  const detail = await server.call('bots.get', { botId })
  for (const [where, bot] of [
    ['bots.list', listed],
    ['bots.get', detail]
  ] as const) {
    assert.ok(bot?.context, `${where}: missing bot.context`)
    assert.ok(typeof bot.context.window === 'number' && bot.context.window > 0, `${where}: missing context.window (${JSON.stringify(bot.context)})`)
    if (expectUsed === 'positive') assert.ok(bot.context.used > 0, `${where}: expected context.used > 0 (${JSON.stringify(bot.context)})`)
    else assert.equal(bot.context.used, 0, `${where}: expected context.used === 0 (${JSON.stringify(bot.context)})`)
  }
}

/** Triggers a real Hermes auto-compaction on the temp dev profile and verifies the compaction marker in history. */
export async function checkCompactionMarker(server: RestartServer, botId: string, turn: (chatId: string, text: string) => Promise<any>) {
  const native = [...server.natives][0]
  assert.ok(native, 'no temporary dev profile found')
  const done = Bun.spawnSync([process.env.LILBOT_HERMES_BIN ?? 'hermes', '-p', native, 'config', 'set', 'compression.threshold_tokens', '65000'], { env: process.env })
  assert.equal(done.exitCode, 0, 'failed to set compression.threshold_tokens on dev profile')
  const chat = await server.call('chat.new', { botId })
  // Opener + 3 passages + short tail ensures >= 9 messages (above Hermes' minimum) and > 65k tokens.
  await turn(chat.chatId, 'Reply with just START.')
  await turn(chat.chatId, `Here is passage one. Reply with just OK.\n\n${passage(1)}`)
  await turn(chat.chatId, `Here is passage two. Reply with just OK.\n\n${passage(2)}`)
  const third = await turn(chat.chatId, `Here is passage three. Reply with just OK.\n\n${passage(3)}`)
  if (!third?.compacted) await turn(chat.chatId, 'Reply with just COMPACT_CHECK.')
  const page = await waitFor(
    'compaction marker in history',
    () => server.call('chat.history', { botId }),
    (h: any) => h.items.some((r: any) => r.item.kind === 'compaction'),
    60_000
  )
  const mark = page.items.find((r: any) => r.item.kind === 'compaction')
  assert.ok(mark, 'no compaction marker found in chat.history')
  assert.equal(mark.author, 'system')
  assert.ok(mark.item.summary || mark.item.compactedMessages !== undefined, `compaction marker empty: ${JSON.stringify(mark)}`)
  assert.ok(
    typeof mark.item.beforeTokens === 'number' && typeof mark.item.afterTokens === 'number' && mark.item.beforeTokens > mark.item.afterTokens,
    `compaction marker missing shrinking before/after tokens: ${JSON.stringify(mark.item)}`
  )
  const reopened = await server.call('chat.open', { botId })
  assert.ok(
    reopened.items.some((i: any) => i.kind === 'compaction'),
    'chat.open snapshot missing compaction marker'
  )
  await server.call('chat.close', { chatId: reopened.chatId })
  console.log(`ok: real compaction marker in history (messages=${mark.item.compactedMessages ?? '?'}, before=${mark.item.beforeTokens}, after=${mark.item.afterTokens})`)
}
