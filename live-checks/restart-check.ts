import '../scripts/dev-env'
/** SIGKILL only an isolated LilBot child while Hermes continues a non-idempotent file write. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { botCapability } from '../server/bots/bot-capability'
import type { ChatSnapshot } from '../shared/chat-schema'
import { applyChatEvent, chatFromSnapshot } from '../web/src/chat/chat-state'
import { RestartServer, reopenChat, waitFor } from './restart-server'

const server = await RestartServer.create()
const read = (path: string) => readFile(path, 'utf8').catch(() => '')
function task(workspace: string, name: string) {
  const counter = join(workspace, `${name}.count`)
  const gate = join(workspace, `${name}.release`)
  const done = join(workspace, `${name}.done`)
  server.gates.push(gate)
  // Increment BEFORE the wait: a duplicated admission produces 2, not a false pass from overwriting 1.
  const program = `from pathlib import Path; import time; p=Path(${JSON.stringify(counter)}); p.write_text(str(int(p.read_text())+1) if p.exists() else '1'); end=time.time()+180\nwhile not Path(${JSON.stringify(gate)}).exists() and time.time()<end: time.sleep(0.2)\nassert Path(${JSON.stringify(gate)}).exists(), 'test gate timed out'\nPath(${JSON.stringify(done)}).write_text('done')`
  return {
    counter,
    gate,
    done,
    prompt: `This is an isolated restart test. Execute the following Python program exactly once using your terminal tool (python3). If the terminal backgrounds it, poll that same process until it completes; do not execute it again. Do not change the program or create the release file. Then reply with exactly ${name.toUpperCase()}_DONE.\n\n${program}`
  }
}
async function started(t: ReturnType<typeof task>) {
  await waitFor(
    'counter increment before restart',
    () => read(t.counter),
    value => value === '1'
  )
}
function assertTranscript(chat: ChatSnapshot, marker: string) {
  assert.equal(chat.running, false, 'Recovered conversation is still running')
  assert.ok(
    chat.items.some(i => i.kind === 'tool'),
    'Recovered transcript lost the tool work'
  )
  assert.equal(chat.items.filter(i => i.kind === 'assistant' && i.text.includes(marker)).length, 1, 'Final answer is missing or duplicated')
}
async function settled(botId: string, marker: string) {
  return waitFor(
    'final answer and settled chat',
    () => reopenChat(() => server.call('chat.open', { botId })),
    (c: ChatSnapshot) => !c.running && c.items.some(i => i.kind === 'assistant' && i.text.includes(marker))
  )
}
async function enginePost(botId: string, path: string, body: unknown) {
  const token = (await readFile(join(server.root, 'engine-token'), 'utf8')).trim()
  const response = await fetch(`http://127.0.0.1:${server.port}/engine/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'X-LilBot-Bot-Capability': botCapability(token, botId), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  })
  assert.equal(response.status, 200, `Engine API refused ${path}`)
  return response.json() as Promise<any>
}
try {
  await server.start()
  await server.connect()
  assert.deepEqual(await server.call('bots.list'), [])
  const bot = await server.createBot(
    'Restart caller',
    'Follow the isolated test exactly. Never repeat a file write. When a bot answer arrives, report it verbatim to Oscar. Do not ask another bot unless explicitly asked.'
  )
  const helper = await server.createBot('Restart helper', 'Follow the requested isolated test exactly. Execute the supplied program once. Do not ask any other bot.')

  for (const offline of [false, true]) {
    const name = offline ? 'chat_offline' : 'chat_live'
    const t = task(bot.workspace, name)
    const chat = await server.call('chat.new', { botId: bot.id })
    await server.call('chat.send', { chatId: chat.chatId, text: t.prompt })
    await started(t)
    await server.crash()
    if (offline) {
      await writeFile(t.gate, 'release')
      await waitFor('engine finishes tool while LilBot is down', () => read(t.done), Boolean)
    }
    await server.start()
    await server.connect()
    const eventStart = server.events.length
    const reopened = await reopenChat(() => server.call('chat.open', { botId: bot.id }))
    assert.equal(reopened.chatId, chat.chatId)
    if (!offline) {
      assert.equal(reopened.running, true)
      await writeFile(t.gate, 'release')
      const frames = await waitFor(
        'reconnected browser receives final event',
        async () => server.events.slice(eventStart),
        frames => frames.some(f => f.event === 'chat' && f.chatId === chat.chatId && f.data.type === 'turn.finished')
      )
      const view = frames.filter(f => f.event === 'chat' && f.chatId === chat.chatId).reduce((view, f) => applyChatEvent(view, f.data), chatFromSnapshot(reopened))
      assert.equal(view.running, false, 'Reconnected browser remains stuck after final event')
      assert.equal(view.items.filter((i: any) => i.kind === 'assistant' && i.text.includes('CHAT_LIVE_DONE')).length, 1)
    }
    const result = await settled(bot.id, `${name.toUpperCase()}_DONE`)
    assertTranscript(result, `${name.toUpperCase()}_DONE`)
    assert.equal(result.items.filter((i: any) => i.kind === 'user').length, 1)
    assert.equal(await read(t.counter), '1')
    console.log(`ok: ${name} resumes the same conversation, tool history and final answer; counter=1`)
  }

  const t = task(bot.workspace, 'routine')
  const routine = await enginePost(bot.id, 'routines/create', {
    requestId: 'restart-routine',
    description: t.prompt,
    createdBy: 'oscar',
    schedule: { kind: 'interval', seconds: 300 }
  })
  // Make just this temporary routine due now; keep its normal interval and pause after admission.
  const { Database } = await import('bun:sqlite')
  const db = new Database(join(server.root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  try {
    db.query('UPDATE routines SET next_run_at=? WHERE id=?').run(Date.now() - 1, routine.id)
  } finally {
    db.close()
  }
  await started(t)
  await server.call('routines.pause', { botId: bot.id, id: routine.id })
  const before = (await server.call('routines.list', { botId: bot.id }))[0].runs[0]
  await server.crash()
  await writeFile(t.gate, 'release')
  await waitFor('routine tool finishes offline', () => read(t.done), Boolean)
  await server.start()
  await server.connect()
  const recovered = await waitFor(
    'routine receipt recovered',
    () => server.call('routines.list', { botId: bot.id }),
    rows => rows[0].runs[0].status === 'completed'
  )
  assert.equal(recovered[0].runs.length, 1)
  assert.equal(recovered[0].runs[0].id, before.id)
  assert.equal(recovered[0].runs[0].chatId, before.chatId)
  assertTranscript(await reopenChat(() => server.call('routines.openRun', { botId: bot.id, runId: before.id })), 'ROUTINE_DONE')
  assert.equal(await read(t.counter), '1')
  console.log('ok: in-flight routine recovers its receipt, transcript and final answer; counter=1')

  const threadTask = task(helper.workspace, 'thread')
  const main = await reopenChat(() => server.call('chat.open', { botId: bot.id }))
  const thread = await enginePost(bot.id, 'threads/ask', { to: helper.id, requestId: 'restart-thread', chatId: main.chatId, text: threadTask.prompt })
  await started(threadTask)
  await server.crash()
  await server.start()
  await server.connect()
  await writeFile(threadTask.gate, 'release')
  const result = await settled(bot.id, 'THREAD_DONE')
  const shared = await waitFor(
    'thread answer persisted',
    () => server.call('threads.open', { botId: bot.id, threadId: thread.threadId }),
    value => value.messages.length === 2
  )
  assert.equal(shared.messages[1].authorId, helper.id)
  assert.ok(shared.messages[1].items.some((i: any) => i.kind === 'tool'))
  assert.ok(shared.messages[1].items.some((i: any) => i.kind === 'assistant' && i.text.includes('THREAD_DONE')))
  assert.equal(result.items.filter((i: any) => i.threadId === thread.threadId).length, 1)
  assert.equal(result.items.filter((i: any) => i.kind === 'assistant' && i.text.includes('THREAD_DONE')).length, 1)
  assert.equal(await read(threadTask.counter), '1')
  // Reopen once more after another restart to catch delayed duplicate admissions/deliveries.
  await server.crash()
  await server.start()
  await server.connect()
  assert.equal((await settled(bot.id, 'THREAD_DONE')).items.filter((i: any) => i.kind === 'assistant' && i.text.includes('THREAD_DONE')).length, 1)
  assert.equal((await server.call('threads.open', { botId: bot.id, threadId: thread.threadId })).messages.length, 2)
  for (const name of ['chat_live', 'chat_offline', 'routine']) assert.equal(await read(join(bot.workspace, `${name}.count`)), '1')
  assert.equal(await read(threadTask.counter), '1')
  console.log('ok: thread delivery and caller continuation survive restart without duplication; counter=1')
  console.log('T3: covered by the bridge restart unit test; no live grant copied or used.')
} finally {
  await server.cleanup()
}
