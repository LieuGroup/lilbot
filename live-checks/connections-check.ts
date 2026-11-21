import { devScratch } from '../scripts/dev-env'
import { deleteProfile } from './check-process'
import { devPort } from '../scripts/dev-paths'
/** `check:connections` (#187): isolated dev server + Access door on local test keys; connects plain & OAuth MCP services
 *  in one conversation, verifies default-off callback 404, opt-in callback, paste fallback, M3, refresh, expiry, removal & token isolation. */
import assert from 'node:assert/strict'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { skillHome } from '../server/engines/hermes/hermes-skills'
import { serviceFixture } from '../tests/connections/service-fixture'
import { accessEnv, fakeAccess } from '../tests/http/access-fixture'
import { conversation, filesHolding, linkIn, openOnAccess, signInPage, startCheckServer, statusOf } from './connections-check-kit'

const scratch = devScratch('lilbot-connections-live')
const free = (taken: number[]): number => {
  const port = devPort()
  return [3370, 3372, 3373, ...taken].includes(port) ? free(taken) : port
}
const port = free([])
const accessPort = free([port])
const keys = fakeAccess()
let plain = serviceFixture({ oauth: false, marker: 'PLAIN_CHECK_' })
const oauth = serviceFixture({ oauth: true, marker: 'OAUTH_CHECK_' })
const engine = new HermesEngine([])
const log = join(scratch, 'server.log')
let nativeId = ''
let child: ReturnType<typeof Bun.spawn> | undefined
let close = () => {}
const pass = (text: string) => console.log(`PASS: ${text}`)
/** The names in the profile's `mcp_servers:` block (two-space keys until the next top-level key). */
const servers = (config: string) => {
  const block = config.split(/^mcp_servers:\s*$/m)[1]?.split(/^\S/m)[0] ?? ''
  return [...block.matchAll(/^ {2}([A-Za-z0-9_-]+):/gm)].map(match => match[1])
}

try {
  nativeId = await engine.createRuntime({
    id: crypto.randomUUID(),
    model: null,
    reasoningEffort: null,
    permissionMode: 'full-access',
    isDefault: false,
    name: 'Connections live check',
    function: 'Temporary connections check',
    instructions: 'Follow the user exactly and briefly. Use LilBot tools (lilbot_connection, lilbot_status) for connections. Quote tool results exactly.'
  })
  const profileConfig = () => readFileSync(join(skillHome(nativeId), 'config.yaml'), 'utf8')
  const othersBefore = servers(profileConfig()).filter(name => !name.startsWith('lilbot_'))
  const baseEnv = {
    ...accessEnv,
    LILBOT_PORT: String(port),
    LILBOT_ACCESS_PORT: String(accessPort),
    LILBOT_ACCESS_TEST_CERTS_URL: keys.settings.certsUrl.href,
    LILBOT_PUBLIC_PORT: String(free([port, accessPort])),
    LILBOT_DATA_DIR: scratch,
    LILBOT_WORKSPACES_DIR: join(scratch, 'workspaces'),
    LILBOT_SKILLS_DIR: join(scratch, 'skills'),
    LILBOT_BOT_IDS: nativeId,
    LILBOT_SKIP_MEMORY_SETUP: '1',
    LILBOT_REVIEW: 'off',
    LILBOT_CONNECTION_TEST_SIGN_IN_SECONDS: '20'
  }
  child = await startCheckServer(baseEnv, log)
  const offCb = await openOnAccess(accessPort, `https://${accessEnv.LILBOT_ACCESS_HOST}/api/connections/callback?code=c&state=s`)
  assert.ok(offCb.status === 404 && !offCb.text.includes('<!doctype html>'), 'default-off callback must be plain 404')
  pass('Access callback route is 404 by default (no app-shell fallthrough)')
  child.kill()
  await child.exited
  child = await startCheckServer({ ...baseEnv, LILBOT_ACCESS_CALLBACK_ENABLED: '1' }, log)
  const chat = await conversation(port)
  close = () => chat.client.socket.close()
  const status = async (name: string) => (await statusOf(port, scratch, chat.botId)).find(row => row.name === name)

  await chat.say(`Connect the MCP service at ${plain.address} with lilbot_connection; name it plaincheck. Reply in one sentence.`)
  assert.equal((await status('plaincheck'))?.state, 'connected')
  for (let i = 0; !servers(profileConfig()).includes('lilbot_c_plaincheck') && i < 30; i++) await Bun.sleep(500)
  assert.ok(servers(profileConfig()).includes('lilbot_c_plaincheck'), 'the engine was not given the new service')
  const plainReply = await chat.say('Use the plaincheck echo tool with the text hello and tell me exactly what it returned.')
  assert.ok(plain.counts.toolCalls >= 1 && plainReply.includes('PLAIN_CHECK_hello'), 'the plain tool was not used in the next message')
  pass('a service with no sign-in is connected at once and its tool works in the next message of the same conversation')

  const asked = await chat.say(`Connect the MCP service at ${oauth.address} with lilbot_connection; name it oauthcheck. Give me its sign-in link exactly as LilBot returns it.`)
  assert.equal((await status('oauthcheck'))?.state, 'needs_sign_in')
  const link = linkIn(asked, oauth.server.port!)
  assert.ok(link, 'the bot gave no sign-in link')
  const landed = await signInPage(link)
  assert.equal((await openOnAccess(accessPort, landed, false)).status, 403, 'the door let a callback without an Access login through')
  const forged = new URL(landed)
  forged.searchParams.set('state', 'forged-state-value')
  assert.equal((await openOnAccess(accessPort, forged.href)).status, 400, 'a wrong state was accepted')
  const signedAt = Date.now()
  const done = await openOnAccess(accessPort, landed)
  assert.ok(done.status === 200 && done.text.includes('Signed in'), 'the Access callback did not sign in')
  assert.equal((await openOnAccess(accessPort, landed)).status, 400, 'a reused callback was accepted')
  await chat.lilbotReply(signedAt)
  assert.equal((await status('oauthcheck'))?.state, 'connected')
  const used = await chat.say('Use the oauthcheck tool with the text world and tell me exactly what it returned.')
  assert.ok(used.includes('OAUTH_CHECK_world'), 'the signed-in tool was not used')
  pass('sign-in link, browser on another device through the Access route, "connected" turn, tool used in the same conversation')
  pass('a callback without an Access login (refused by the door), a wrong state and a reused callback are refused')

  const denied = await chat.say('Call lilbot_connection with action sign_in for oauthcheck now and tell me what LilBot answered.')
  assert.ok((await status('oauthcheck'))?.state === 'connected' && !linkIn(denied, oauth.server.port!), 'sign_in allowed while connected')
  pass('sign_in while already connected is refused (M3)')

  oauth.expireAccess()
  const refreshes = oauth.counts.refreshGrants
  assert.ok(
    (await chat.say('Use the oauthcheck tool with the text again and tell me exactly what it returned.')).includes('OAUTH_CHECK_again') && oauth.counts.refreshGrants > refreshes
  )
  pass('an expired access token is refreshed by LilBot and the call goes through')

  oauth.revoke()
  await chat.say('Use the oauthcheck tool with the text expired and tell me what happened.')
  assert.equal((await status('oauthcheck'))?.state, 'sign_in_expired')
  const lateLink = linkIn(await chat.say('Give me a fresh sign-in link for oauthcheck, exactly as LilBot returns it.'), oauth.server.port!)
  assert.ok(lateLink, 'no fresh link while expired')
  const late = await signInPage(lateLink)
  await Bun.sleep(21_000)
  assert.equal((await openOnAccess(accessPort, late)).status, 400, 'a callback after the sign-in window was accepted')
  pass('a callback after the sign-in window (20 s on this server, 10 minutes in production) is refused')

  const repairLink = linkIn(await chat.say('Give me another fresh sign-in link for oauthcheck, exactly as LilBot returns it.'), oauth.server.port!)
  assert.ok(repairLink, 'no repair link')
  const pasted = await signInPage(repairLink)
  const pastedAt = Date.now()
  const finished = await chat.say(`My browser could not open the last page of the sign-in. It ended on this address; finish the sign-in with it: ${pasted}`)
  assert.equal((await status('oauthcheck'))?.state, 'connected')
  await chat.lilbotReply(pastedAt, finished)
  assert.ok((await chat.say('Use the oauthcheck tool with the text repaired and tell me exactly what it returned.')).includes('OAUTH_CHECK_repaired'))
  pass('a refused token shows sign_in_expired; a new sign_in, finished by pasting the final address, repairs it')

  const plainPort = plain.server.port!
  plain.stop()
  await chat.say('Use the plaincheck echo tool with the text down and tell me what happened.')
  assert.equal((await status('plaincheck'))?.state, 'unreachable')
  pass('a service that does not answer shows unreachable, and the bot carries on')

  plain = serviceFixture({ oauth: false, marker: 'PLAIN_CHECK_', port: plainPort })
  await chat.say('Remove the plaincheck connection with lilbot_connection. Reply in one sentence.')
  assert.equal(await status('plaincheck'), undefined)
  for (let i = 0; servers(profileConfig()).includes('lilbot_c_plaincheck') && i < 30; i++) await Bun.sleep(500)
  assert.ok(!servers(profileConfig()).includes('lilbot_c_plaincheck'), 'the engine still has the removed service')
  const gone = await chat.say('Call the plaincheck echo tool with the text gone. If you have no such tool, reply NO_TOOL.')
  assert.equal(plain.counts.toolCalls, 0, 'the removed service was still called')
  assert.ok(gone.includes('NO_TOOL'), 'the bot still found the removed tool')
  pass('removing the service takes its tools away from the open conversation')

  const reopened = await chat.client.call('chat.open', { botId: chat.botId })
  assert.equal(reopened.chatId, chat.chatId, 'the conversation was replaced by a new session')
  assert.deepEqual(
    servers(profileConfig()).filter(name => !name.startsWith('lilbot_')),
    othersBefore
  )
  pass(`one session throughout (${chat.turns()} turns), and the profile's own servers are unchanged`)

  const store = join(scratch, 'mcp-credentials.json')
  assert.equal(statSync(store).mode & 0o777, 0o600)
  assert.ok(
    oauth.issued.some(secret => readFileSync(store, 'utf8').includes(secret)),
    'the store does not hold the tokens'
  )
  const hits = [
    ...filesHolding(scratch, oauth.issued, [store]),
    ...filesHolding(skillHome(nativeId), oauth.issued),
    ...filesHolding(join(process.env.HERMES_HOME!, 'logs'), oauth.issued)
  ]
  assert.deepEqual(hits, [], 'a token was found outside LilBot’s store')
  pass(`${oauth.issued.length} tokens found only in the 0600 store: not in the database, conversation copy, logs, workspace or engine profile`)
} catch (error) {
  // What the server said, for the reader of a failed run (fixed log labels only; it never logs tokens).
  for (const file of [log, `${log}.err`]) {
    try {
      console.error(
        readFileSync(file, 'utf8')
          .split('\n')
          .filter(line => /\[(connections|background|bots|hermes|chat|system)\]/.test(line))
          .slice(-40)
          .join('\n')
      )
    } catch {}
  }
  if (nativeId) console.error(`profile servers: ${servers(readFileSync(join(skillHome(nativeId), 'config.yaml'), 'utf8')).join(', ')}`)
  throw error
} finally {
  close()
  child?.kill()
  if (child) await child.exited
  plain.stop()
  oauth.stop()
  keys.server.stop(true)
  if (nativeId && (await deleteProfile(nativeId).exited) !== 0) {
    console.error(`Cleanup failed for ${nativeId}`)
    process.exitCode = 1
  }
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
