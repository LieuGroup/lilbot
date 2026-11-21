import { devScratch } from '../scripts/dev-env'
import { checkClient } from './check-client'
import { startServer, deleteProfile } from './check-process'
import { devPort } from '../scripts/dev-paths'
import { waitFor } from './wait-for'
/** Real protocol and download check, isolated from the live service and all existing bots. */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from '../server/database/database'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'

const scratch = devScratch('lilbot-library-live')
const port = devPort()
const engine = new HermesEngine([])
let nativeId = ''
let child: ReturnType<typeof Bun.spawn> | undefined
let socket: WebSocket | undefined
try {
  nativeId = await engine.createRuntime({
    id: crypto.randomUUID(),
    model: null,
    reasoningEffort: null,
    permissionMode: 'full-access',
    isDefault: false,
    name: 'Library live check',
    function: 'Temporary library check',
    instructions:
      'Follow the user exactly. Use terminal to create files, then deliver to Oscar only the files he asks for. Schedule work with LilBot routines, never cronjob. The test server permits 3-second intervals.'
  })
  child = startServer({
    ...process.env,
    LILBOT_PORT: String(port),
    LILBOT_DATA_DIR: scratch,
    LILBOT_SKILLS_DIR: join(scratch, 'skills'),
    LILBOT_WORKSPACES_DIR: join(scratch, 'workspaces'),
    LILBOT_BOT_IDS: nativeId,
    LILBOT_SKIP_MEMORY_SETUP: '1',
    LILBOT_REVIEW: 'off',
    LILBOT_ROUTINE_TEST_INTERVAL_SECONDS: '3'
  })
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(`http://127.0.0.1:${port}/api/health`)
        .then(r => r.ok)
        .catch(() => false)
    )
      break
    await Bun.sleep(100)
  }
  let pushed = false
  let finish: (value: any) => void = () => {}
  const client = await checkClient(port, frame => {
    if (frame.event === 'library.changed') pushed = true
    if (frame.event === 'chat' && frame.data.type === 'turn.finished') finish(frame.data)
  })
  socket = client.socket
  const call = client.call
  const bots = await call('bots.list', {})
  if (bots.length !== 1) throw new Error('Isolation failed')
  const botId = bots[0].id
  await call('memory.connect', { botId })
  const chat = await call('chat.open', { botId })
  const done = new Promise<any>((resolve, reject) => {
    finish = resolve
    setTimeout(() => reject(new Error('Turn timed out')), 120000).unref()
  })
  await call('chat.send', {
    chatId: chat.chatId,
    text: 'Create delivery.txt in your current workspace containing exactly LIBRARY_LIVE_OK. Also create working.txt containing scratch. Give delivery.txt to Oscar with title Library live result. Do not give working.txt. Then stop.'
  })
  const result = await done
  if (result.status !== 'completed') throw new Error(`Turn status ${result.status}`)
  const page = await call('library.list', { botId })
  const db = openDatabase(join(scratch, 'lilbot.db'))
  const logged = db.query<{ tool: string; target: string }, []>("SELECT tool, target FROM system_changes WHERE tool = 'lilbot_give_file'").all()
  db.close()
  if (logged.length !== 1 || logged[0].target !== page.items[0]?.id) throw new Error(`The file was not given through LilBot's tool: ${JSON.stringify(logged)}`)
  if (!pushed || page.total !== 1 || page.items[0].title !== 'Library live result' || page.items[0].missing) throw new Error('Library delivery or push failed')
  if (page.items[0].chatId !== chat.chatId || page.items[0].routineRunId !== null) throw new Error(`Wrong provenance ${JSON.stringify(page.items[0])}`)
  const { url } = await call('library.content', { botId, itemId: page.items[0].id })
  const response = await fetch(`http://127.0.0.1:${port}${url}`)
  if (!response.ok || !(await response.text()).includes('LIBRARY_LIVE_OK') || !response.headers.get('content-type')?.startsWith('text/plain')) throw new Error('Download failed')
  const entries = await call('library.workspace', { botId })
  if (!entries.some((entry: any) => entry.name === 'working.txt')) throw new Error('Workspace listing failed')
  const denied = await fetch(`http://127.0.0.1:${port}${url}`, { headers: { origin: 'https://evil.example' } })
  if (denied.status !== 403) throw new Error('Cross origin download was accepted')
  console.log('A routine run gives a file from its own hidden session')
  const poll = <T>(read: () => Promise<T>, done: (value: T) => boolean, label: string): Promise<T> => waitFor(read, done, { label, timeout: 240_000, interval: 500 })
  const routineTurn = new Promise<any>((resolve, reject) => {
    finish = resolve
    setTimeout(() => reject(new Error('Routine turn timed out')), 120000).unref()
  })
  await call('chat.send', {
    chatId: chat.chatId,
    text: 'Create one LilBot routine requested by Oscar (createdBy oscar) that runs every 3 seconds and does this: create routine-delivery.txt in your workspace containing exactly ROUTINE_LIVE_OK, then give it to Oscar with title Routine live result. Then reply briefly.'
  })
  await routineTurn
  const delivered = await poll(
    async () => (await call('library.list', { botId })).items.find((item: any) => item.title === 'Routine live result'),
    item => Boolean(item),
    'the routine run to give its file'
  )
  const [routine] = await call('routines.list', { botId })
  await call('routines.delete', { botId, id: routine.id })
  if (!routine.runs.some((run: any) => run.id === delivered.routineRunId) || delivered.chatId === chat.chatId)
    throw new Error(`The routine run's file has the wrong provenance ${JSON.stringify(delivered)}`)
  console.log(
    'PASS: real bot lilbot_give_file (logged in system_changes); library.changed; protocol list, provenance and separate workspace; safe download and cross-origin refusal; a routine run gives from its hidden session and the item records the run.'
  )
} finally {
  socket?.close()
  child?.kill()
  if (child) await child.exited
  if (nativeId) {
    const cleanup = deleteProfile(nativeId)
    if ((await cleanup.exited) !== 0) {
      console.error(`Cleanup failed for ${nativeId}`)
      process.exitCode = 1
    }
  }
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
