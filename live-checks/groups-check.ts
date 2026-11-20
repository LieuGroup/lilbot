import '../scripts/dev-env'
/** `bun run check:groups`: on an isolated dev server (round limit lowered to 3) three temporary bots. One leads a group
 *  whose members reply in parallel, a file goes in and one comes back, LilBot is killed and restarted mid-round, and the
 *  leader closes with an outcome that reaches its conversation; a second group is stopped by Oscar; a third ends by
 *  itself at the round limit. Nothing runs or is delivered twice. About twenty model turns; cleanup runs in `finally`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RestartServer, reopenChat, waitFor } from './restart-server'

const server = await RestartServer.create('lilbot-groups', { LILBOT_GROUP_TEST_ROUNDS: '3' })
const WORD = `OSPREY-${Math.floor(Math.random() * 9000 + 1000)}`
const LEAD = `You lead temporary groups in a live check. Follow these rules exactly and never poll.
- In the group whose purpose starts with "Close-test": when round 1's replies are in, call lilbot_group once with action say, that groupId, requestId close-test-2, to ["Group Scribe"] and text "Run python3 gate.py in your own folder exactly once and wait until it finishes. Then write the secret word from round 1 into answer.txt in your folder, call lilbot_group with action attach and files [\\"answer.txt\\"], and reply SCRIBE_DONE." When round 2's replies are in, call lilbot_group once with action close, requestId close-test-end, text "OUTCOME" followed by the secret word, and keep ["answer.txt"].
- In the group whose purpose starts with "Cap-test": after each round's replies, call lilbot_group once with action say, requestId cap-test- followed by the next round's number, to ["Group Scout"] and text "Reply ROUND and the round number." Never close it.
- When LilBot tells you a group you led has closed, was stopped or ended by itself, reply GROUP_REPORT, how it ended, and the secret word if you know it.`
const MEMBER =
  'You are a member of temporary groups in a live check. Do exactly what each point says, with your terminal tool when it needs a command, and reply in one short line. Never start a group and never contact other bots.'
let db: Database | undefined
const q = (sql: string, ...args: string[]) => db!.query(sql).all(...args) as any[]
const open = (botId: string, threadId: string) => server.call('threads.open', { botId, threadId })
const until = <T>(label: string, read: () => Promise<T> | T, ok: (value: T) => boolean, timeout = 400_000) => waitFor(label, async () => read(), ok, timeout)
const reports = async (botId: string) => {
  const chat = await reopenChat(() => server.call('chat.open', { botId }))
  return (chat.items as any[]).filter(i => i.kind === 'assistant' && i.text.includes('GROUP_REPORT')).map(i => i.text as string)
}
const groupOf = (requestId: string) => until(`group ${requestId}`, () => q('SELECT thread_id FROM thread_groups WHERE request_id=?', requestId)[0]?.thread_id as string, Boolean)
/** No message twice, and the outcome went out once: its delivery settles when the engine's receipt is final, a moment after the turn. */
const once = async (groupId: string) => {
  const { messages } = q('SELECT data FROM threads WHERE id=?', groupId).map(r => JSON.parse(r.data))[0]
  assert.equal(new Set(messages.map((m: any) => m.id)).size, messages.length, 'a message was recorded twice')
  await until('the outcome to settle', () => q("SELECT id FROM thread_deliveries WHERE id=? AND status='done'", `group:${groupId}:end`).length, n => n === 1, 60_000)
}
try {
  await server.start()
  await server.connect()
  const lead = await server.createBot('Group Lead', LEAD)
  const scout = await server.createBot('Group Scout', MEMBER)
  const scribe = await server.createBot('Group Scribe', MEMBER)
  db = new Database(join(server.root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  await until(
    'the bots to be ready',
    () => server.call('bots.list'),
    (bots: any[]) => bots.length === 3 && bots.every(b => !b.runtimePending),
    120_000
  )
  for (const bot of [lead, scribe]) mkdirSync(bot.workspace, { recursive: true })
  writeFileSync(join(lead.workspace, 'brief.txt'), `The secret word is ${WORD}.\n`)
  const [counter, gate] = ['gate.count', 'gate.release'].map(name => join(scribe.workspace, name))
  server.gates.push(gate)
  // Counts before it waits, so a repeated run shows 2.
  writeFileSync(
    join(scribe.workspace, 'gate.py'),
    `from pathlib import Path; import time\np=Path(${JSON.stringify(counter)}); p.write_text(str(int(p.read_text())+1) if p.exists() else '1')\nend=time.time()+300\nwhile not Path(${JSON.stringify(gate)}).exists() and time.time()<end: time.sleep(0.2)\n`
  )
  const main = await server.call('chat.open', { botId: lead.id })
  console.log('ok: three temporary bots, a brief in the lead’s folder, a gated script in the scribe’s')

  await server.call('chat.send', {
    chatId: main.chatId,
    text: 'Call lilbot_group once with action start, requestId close-test, purpose "Close-test: find the word", members ["Group Scout", "Group Scribe"], files ["brief.txt"] and text "Round one: read brief.txt in the group folder and reply with the secret word in it." Then reply STARTED.'
  })
  const g1 = await groupOf('close-test')
  const both = await until(
    'both members at work at once',
    () => open(lead.id, g1),
    (t: any) => t.group.members.filter((m: any) => m.state === 'working').length === 2
  )
  assert.equal(both.messages[0].files[0].name, 'brief.txt')
  assert.ok(readFileSync(join(both.group.folder, both.messages[0].files[0].path), 'utf8').includes(WORD), 'the brief was copied into the group folder')
  const roster = Object.fromEntries((await server.call('bots.list')).map((b: any) => [b.name, b.groups?.[0]?.leading]))
  assert.deepEqual(roster, { 'Group Lead': true, 'Group Scout': false, 'Group Scribe': false })
  console.log('ok: the group started, both members work at once, the brief is in the group folder, the roster shows the group')

  const second = await until(
    'round two, to the scribe',
    () => open(lead.id, g1),
    (t: any) => t.group.rounds.length === 2
  )
  assert.deepEqual(second.group.rounds[1].to, [scribe.id])
  assert.equal(second.messages.filter((m: any) => m.authorId !== lead.id && JSON.stringify(m.items).includes(WORD)).length, 2, 'both found the word in round one')
  await until(
    'the gated script to start',
    () => (existsSync(counter) ? readFileSync(counter, 'utf8') : ''),
    v => v === '1'
  )
  await server.crash()
  await server.start()
  await server.connect()
  await until(
    'the scribe’s turn picked up again',
    () => open(lead.id, g1),
    (t: any) => t.group.members.find((m: any) => m.id === scribe.id).state === 'working'
  )
  writeFileSync(gate, 'release')
  const closed = await until(
    'the leader to close',
    () => open(lead.id, g1),
    (t: any) => !!t.group.end
  )
  assert.equal(closed.group.end.how, 'closed')
  assert.ok(closed.group.end.outcome.includes(WORD), 'the outcome names the word')
  assert.equal(readFileSync(counter, 'utf8'), '1', 'the scribe’s script ran once across the restart')
  assert.equal(closed.messages.filter((m: any) => m.authorId === scribe.id && JSON.stringify(m.items).includes('SCRIBE_DONE')).length, 1)
  assert.equal(q("SELECT id FROM thread_deliveries WHERE threadId=? AND kind='round'", g1).length, 2, 'one leader turn per round')
  const [kept] = closed.group.kept
  assert.ok(readFileSync(join(lead.workspace, kept.path), 'utf8').includes(WORD), 'the scribe’s file came back and the leader kept it')
  assert.equal(q("SELECT id FROM library_items WHERE bot_id=? AND title='answer.txt'", lead.id).length, 1)
  await until('the folder to be archived', () => existsSync(join(server.root, 'workspaces', '.archive', '.groups', g1)), Boolean, 30_000)
  assert.ok(!existsSync(join(server.root, 'workspaces', '.groups', g1)))
  assert.equal(q("SELECT id FROM memory_facts WHERE kind='journal' AND text LIKE '%Close-test%' AND bot_id IN (?,?)", scout.id, scribe.id).length, 2)
  const first = await until(
    'the outcome in the lead’s conversation',
    () => reports(lead.id),
    r => r.length === 1
  )
  assert.ok(first[0].includes(WORD))
  await once(g1)
  assert.ok(
    (await server.call('bots.list')).every((b: any) => !b.groups),
    'the roster drops the group'
  )
  console.log(`ok: two rounds, a restart mid-round with the script run once, a file back and kept, the outcome reported: ${first[0].slice(0, 120)}`)

  await server.call('chat.send', {
    chatId: main.chatId,
    text: 'Call lilbot_group once with action start, requestId stop-test, purpose "Stop-test: wait", members ["Group Scout", "Group Scribe"] and text "Run sleep 300 in your terminal, then reply DONE." Then reply STARTED.'
  })
  const g2 = await groupOf('stop-test')
  await until(
    'both members sleeping',
    () => open(lead.id, g2),
    (t: any) => t.group.members.filter((m: any) => m.state === 'working').length === 2
  )
  const stopped = await server.call('threads.cancel', { botId: lead.id, threadId: g2 })
  assert.equal(stopped.status, 'cancelled')
  assert.deepEqual([stopped.stoppedBy.kind, stopped.group.end.how], ['oscar', 'stopped'])
  await until(
    'both members stopped',
    () => open(lead.id, g2),
    (t: any) => t.group.members.every((m: any) => m.state === 'idle'),
    60_000
  )
  const told = await until(
    'the lead told',
    () => reports(lead.id),
    r => r.length === 2
  )
  assert.equal(q("SELECT id FROM thread_deliveries WHERE threadId=? AND kind='round'", g2).length, 0)
  await once(g2)
  console.log(`ok: Oscar stopped a group; both members stopped and the lead was told: ${told[1].slice(0, 120)}`)

  await server.call('chat.send', {
    chatId: main.chatId,
    text: 'Call lilbot_group once with action start, requestId cap-test, purpose "Cap-test: count", members ["Group Scout", "Group Scribe"], to ["Group Scout"] and text "Reply ROUND and the round number." Then reply STARTED.'
  })
  const g3 = await groupOf('cap-test')
  const capped = await until(
    'the group to end at its round limit',
    () => open(lead.id, g3),
    (t: any) => !!t.group.end,
    600_000
  )
  assert.deepEqual([capped.group.end.how, capped.group.roundCap, capped.group.rounds.length, capped.group.turns], ['rounds', 3, 3, 5])
  assert.equal(capped.group.end.outcome, 'Ended by itself at the round limit (3 rounds).')
  assert.equal(q("SELECT id FROM thread_deliveries WHERE threadId=? AND kind='round'", g3).length, 2)
  const last = await until(
    'the lead told of the limit',
    () => reports(lead.id),
    r => r.length === 3
  )
  await once(g3)
  const listed = await server.call('threads.list', { botId: scout.id })
  assert.deepEqual(
    listed
      .filter((t: any) => t.group)
      .map((t: any) => t.group.end.how)
      .sort(),
    ['closed', 'rounds', 'stopped']
  )
  console.log(`ok: a group ended by itself at the round limit after 5 turns: ${last[2].slice(0, 120)}`)
} finally {
  db?.close()
  await server.cleanup()
}
