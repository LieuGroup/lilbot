import { devScratch } from '../scripts/dev-env'
import { deleteProfile } from './check-process'
import { devPort } from '../scripts/dev-paths'
/** `check:connections` (#187, #216): isolated dev server + Access door; tests plain & OAuth MCP services with sign-in
 *  cards, browser card paste (callback off), automatic Access callback (callback on), expiry, restart, refresh, removal & secret isolation. */
import assert from 'node:assert/strict'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { skillHome } from '../server/engines/hermes/hermes-skills'
import { serviceFixture } from '../tests/connections/service-fixture'
import { accessEnv, fakeAccess } from '../tests/http/access-fixture'
import { conversation, dumpCheckLogs, filesHolding, linkIn, openOnAccess, profileServers, signInPage, startCheckServer, statusOf } from './connections-check-kit'

const scratch = devScratch('lilbot-connections-live')
const free = (taken: number[]): number => {
  const p = devPort()
  return [3370, 3372, 3373, ...taken].includes(p) ? free(taken) : p
}
const port = free([])
const accessPort = free([port])
const keys = fakeAccess()
let plain = serviceFixture({ oauth: false, marker: 'PLAIN_CHECK_' })
const oauth = serviceFixture({ oauth: true, marker: 'OAUTH_CHECK_' })
const engine = new HermesEngine([])
const log = join(scratch, 'server.log')
const leakedChecks: string[] = []
let nativeId = ''
let child: ReturnType<typeof Bun.spawn> | undefined
let close = () => {}
const pass = (text: string) => console.log(`PASS: ${text}`)
const trackLink = (url: string) => {
  leakedChecks.push(url, ...(new URL(url).searchParams.get('state') ? [new URL(url).searchParams.get('state')!] : []))
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
  const othersBefore = profileServers(profileConfig()).filter(name => !name.startsWith('lilbot_'))
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
  // Phase 1: default-off callback route (404) + sign-in card finished by browser pasted address.
  child = await startCheckServer(baseEnv, log)
  const offCb = await openOnAccess(accessPort, `https://${accessEnv.LILBOT_ACCESS_HOST}/api/connections/callback?code=c&state=s`)
  assert.ok(offCb.status === 404 && !offCb.text.includes('<!doctype html>'), 'default-off callback must be plain 404')
  let chat = await conversation(port)
  close = () => chat.client.socket.close()
  const status = async (name: string) => (await statusOf(port, scratch, chat.botId)).find(row => row.name === name)
  const askedOff = await chat.say(`Connect the MCP service at ${oauth.address} with lilbot_connection; name it oauthcheck. Reply in one sentence.`)
  assert.equal((await status('oauthcheck'))?.state, 'needs_sign_in')
  assert.ok(!linkIn(askedOff, oauth.server.port!), 'bot reply must not contain a sign-in link')
  const card1 = (await chat.historyCards()).find(c => c.serviceName === 'oauthcheck' && c.state === 'waiting')
  assert.ok(card1 && chat.cardEvents.some(c => c.id === card1.id && c.state === 'waiting'), 'waiting sign-in card missing')
  const { url: pasteUrl } = await chat.client.call('connections.signIn.open', { cardId: card1.id })
  trackLink(pasteUrl)
  const pasted = await signInPage(pasteUrl)
  leakedChecks.push(pasted)
  assert.equal((await openOnAccess(accessPort, pasted)).status, 404, 'callback route should be off')
  const pastedAt = Date.now()
  assert.equal((await chat.client.call('connections.signIn.finish', { cardId: card1.id, address: pasted })).state, 'connected')
  await chat.lilbotReply(pastedAt)
  assert.equal((await status('oauthcheck'))?.state, 'connected')
  assert.ok((await chat.say('Use the oauthcheck tool with the text pasted and tell me exactly what it returned.')).includes('OAUTH_CHECK_pasted'))
  pass('callback-off 404 + waiting card + browser paste finish -> connected + hidden turn + tool works')

  const reboot = async (env: Record<string, string>) => {
    close()
    child?.kill()
    await child?.exited
    child = await startCheckServer(env, log)
    chat = await conversation(port)
    close = () => chat.client.socket.close()
  }
  // Phase 2: restart with Access callback enabled; verify plain service, expiry, restart, automatic callback, refresh, removal.
  await reboot({ ...baseEnv, LILBOT_ACCESS_CALLBACK_ENABLED: '1' })

  await chat.say(`Connect the MCP service at ${plain.address} with lilbot_connection; name it plaincheck. Reply in one sentence.`)
  assert.equal((await status('plaincheck'))?.state, 'connected')
  for (let i = 0; !profileServers(profileConfig()).includes('lilbot_c_plaincheck') && i < 30; i++) await Bun.sleep(500)
  assert.ok((await chat.say('Use the plaincheck echo tool with the text hello and tell me exactly what it returned.')).includes('PLAIN_CHECK_hello'))
  pass('a service with no sign-in is connected at once and its tool works in the next message')

  assert.ok(!(await chat.say('Call lilbot_connection with action sign_in for oauthcheck now and tell me what LilBot answered.')).includes('/authorize?'))
  assert.equal((await status('oauthcheck'))?.state, 'connected')
  oauth.expireAccess()
  const refreshes = oauth.counts.refreshGrants
  assert.ok(
    (await chat.say('Use the oauthcheck tool with the text again and tell me exactly what it returned.')).includes('OAUTH_CHECK_again') && oauth.counts.refreshGrants > refreshes
  )
  pass('sign_in while connected is refused (M3) and an expired access token refreshes transparently')

  oauth.revoke()
  await chat.say('Use the oauthcheck tool with the text expired and tell me what happened.')
  assert.equal((await status('oauthcheck'))?.state, 'sign_in_expired')
  const repairReply = await chat.say('Call lilbot_connection with action sign_in for oauthcheck so I can sign in again. Reply in one sentence.')
  assert.ok(!linkIn(repairReply, oauth.server.port!), 'repair reply must not contain a sign-in link')
  const card2 = (await chat.historyCards()).find(c => c.serviceName === 'oauthcheck' && c.state === 'waiting')
  assert.ok(card2, 'no waiting repair card created')
  const { url: lateUrl } = await chat.client.call('connections.signIn.open', { cardId: card2.id })
  trackLink(lateUrl)
  const late = await signInPage(lateUrl)
  leakedChecks.push(late)
  await Bun.sleep(21_000)
  assert.equal((await openOnAccess(accessPort, late)).status, 400, 'late callback accepted')
  assert.equal((await chat.historyCards()).find(c => c.id === card2.id)?.state, 'expired')
  pass('waiting card expires after 20 s window and late callback is refused')

  assert.equal((await chat.client.call('connections.signIn.restart', { cardId: card2.id })).state, 'waiting')
  // Real server restart while a card is waiting must boot cleanly (no crash) and expire the card.
  await reboot({ ...baseEnv, LILBOT_ACCESS_CALLBACK_ENABLED: '1' })
  assert.equal((await chat.historyCards()).find(c => c.id === card2.id)?.state, 'expired')

  assert.equal((await chat.client.call('connections.signIn.restart', { cardId: card2.id })).state, 'waiting')
  const { url: autoUrl } = await chat.client.call('connections.signIn.open', { cardId: card2.id })
  trackLink(autoUrl)
  const landed = await signInPage(autoUrl)
  leakedChecks.push(landed)
  assert.equal((await openOnAccess(accessPort, landed, false)).status, 403, 'callback without Access JWT allowed')
  const forged = new URL(landed)
  forged.searchParams.set('state', 'forged-state-value')
  assert.equal((await openOnAccess(accessPort, forged.href)).status, 400, 'forged state accepted')
  const signedAt = Date.now()
  const done = await openOnAccess(accessPort, landed)
  assert.ok(done.status === 200 && done.text.includes('Signed in'), 'automatic Access callback failed')
  assert.equal((await openOnAccess(accessPort, landed)).status, 400, 'reused callback accepted')
  await chat.lilbotReply(signedAt)
  assert.equal((await chat.historyCards()).find(c => c.id === card2.id)?.state, 'connected')
  assert.ok((await chat.say('Use the oauthcheck tool with the text auto and tell me exactly what it returned.')).includes('OAUTH_CHECK_auto'))
  pass('card restart + automatic Access callback -> card connected + hidden turn + tool works')

  const plainPort = plain.server.port!
  plain.stop()
  await chat.say('Use the plaincheck echo tool with the text down and tell me what happened.')
  assert.equal((await status('plaincheck'))?.state, 'unreachable')
  plain = serviceFixture({ oauth: false, marker: 'PLAIN_CHECK_', port: plainPort })
  await chat.say('Remove the plaincheck connection with lilbot_connection. Reply in one sentence.')
  assert.equal(await status('plaincheck'), undefined)
  for (let i = 0; profileServers(profileConfig()).includes('lilbot_c_plaincheck') && i < 30; i++) await Bun.sleep(500)
  assert.ok((await chat.say('Call the plaincheck echo tool with the text gone. If you have no such tool, reply NO_TOOL.')).includes('NO_TOOL'))
  assert.equal((await chat.client.call('chat.open', { botId: chat.botId })).chatId, chat.chatId)
  assert.deepEqual(
    profileServers(profileConfig()).filter(name => !name.startsWith('lilbot_')),
    othersBefore
  )
  pass('unreachable, remove, single session and profile isolation verified')

  const store = join(scratch, 'mcp-credentials.json')
  assert.equal(statSync(store).mode & 0o777, 0o600)
  assert.ok(
    oauth.issued.some(secret => readFileSync(store, 'utf8').includes(secret)),
    'store missing tokens'
  )
  const tokenHits = [
    ...filesHolding(scratch, oauth.issued, [store]),
    ...filesHolding(skillHome(nativeId), oauth.issued),
    ...filesHolding(join(process.env.HERMES_HOME!, 'logs'), oauth.issued)
  ]
  const linkHits = [
    ...filesHolding(scratch, leakedChecks),
    ...filesHolding(skillHome(nativeId), leakedChecks),
    ...filesHolding(join(process.env.HERMES_HOME!, 'logs'), leakedChecks)
  ]
  assert.deepEqual([...tokenHits, ...linkHits], [], 'a token, sign-in link, state or pasted address leaked to disk')
  pass(`${oauth.issued.length} tokens and ${leakedChecks.length} links/states/addresses kept out of DB, history, logs, workspace & profile`)
} catch (error) {
  dumpCheckLogs(log)
  throw error
} finally {
  close()
  child?.kill()
  if (child) await child.exited
  plain.stop()
  oauth.stop()
  keys.server.stop(true)
  if (nativeId && (await deleteProfile(nativeId).exited) !== 0) process.exitCode = 1
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
