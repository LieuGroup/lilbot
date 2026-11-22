import { expect, spyOn, test } from 'bun:test'
import { setUnread } from '../../server/bots/bot-unread'
import { addBot, systemFixture } from './system-fixture'

test('roster tools call the functions the screens call, with the screen’s input, and the roster push goes out', async () => {
  const f = systemFixture()
  const other = await addBot(f, 'Other')
  const setPrefs = spyOn(f.service, 'setPrefs')
  const createSection = spyOn(f.service, 'createSection')
  const listBots = spyOn(f.service, 'listBots')
  const before = f.rosterPushes()
  const section = (await f.call('b1', 'lilbot_section_create', { name: 'Work' })).data
  await f.call('b1', 'lilbot_roster_set', { botId: other.id, pinned: true, hidden: true, sectionId: section.id, avatar: { shape: 'x' } })
  expect(createSection).toHaveBeenCalledWith('Work')
  expect(setPrefs).toHaveBeenCalledWith({ botId: other.id, pinned: true, hidden: true, sectionId: section.id })
  expect(f.rosterPushes()).toBe(before + 2)
  const row = (await f.call('b1', 'lilbot_bots_list')).data
  expect(listBots).toHaveBeenCalled()
  expect(row.sections).toEqual([section])
  expect(row.bots.find((bot: any) => bot.id === other.id)).toMatchObject({ pinned: true, hidden: true, sectionId: section.id })
  expect(row.bots.find((bot: any) => bot.id === other.id).avatar).toBeUndefined()
  // The pin time is the screen's: set by pinning, kept on a repeat, cleared by unpinning.
  const pinnedAt = (await f.service.listBots()).find(bot => bot.id === other.id)?.prefs.pinnedAt
  expect(pinnedAt).toBeNumber()
  expect(row.bots.find((bot: any) => bot.id === other.id).pinnedAt).toBe(pinnedAt)
  expect((await f.call('b1', 'lilbot_roster_set', { botId: other.id, pinned: true })).data.pinnedAt).toBe(pinnedAt)
  expect((await f.call('b1', 'lilbot_roster_set', { botId: other.id, pinned: false })).data).toMatchObject({ pinned: false, pinnedAt: null })
  expect((await f.call('b1', 'lilbot_roster_set', { botId: other.id, sectionId: 'missing' })).error).toContain('does not exist')
  expect((await f.call('b1', 'lilbot_roster_set', { botId: 'missing', pinned: true })).error).toContain('does not exist')
})

test('read and unread go through the same function as the screen', async () => {
  const f = systemFixture()
  const marked = spyOn(f.activity, 'setUnread')
  await f.call('b1', 'lilbot_unread_set', { botId: 'b1', unread: true })
  expect(marked).toHaveBeenCalledWith('b1', true)
  expect(f.activity.state('b1').unread).toBe(true)
  expect((await f.call('b1', 'lilbot_bots_list')).data.bots[0].unread).toBe(true)
  await setUnread(f.service, f.activity, 'b1', false)
  expect(f.activity.state('b1').unread).toBe(false)
  expect((await f.call('b1', 'lilbot_unread_set', { botId: 'missing', unread: true })).error).toContain('does not exist')
})

test('bot tools call the bot service: edit, primary, create, models, delete defaults', async () => {
  const f = systemFixture()
  const other = await addBot(f, 'Other')
  const update = spyOn(f.service, 'updateBot')
  const primary = spyOn(f.service, 'setPrimary')
  const create = spyOn(f.service, 'createFromBot')
  const models = spyOn(f.service, 'listModels')
  const setDefaults = spyOn(f.service, 'setDeleteDefaults')
  await f.call('b1', 'lilbot_bot_edit', { botId: other.id, name: 'Better', permissionMode: 'auto', model: { provider: 'test', model: 'm' } })
  // The permission mode is not an editable field here; the screen's checks still run on what is.
  expect(update).toHaveBeenCalledWith({ botId: other.id, name: 'Better', model: { provider: 'test', model: 'm' } })
  expect(f.store.get(other.id)).toMatchObject({ name: 'Better', permissionMode: 'full-access' })
  expect((await f.call('b1', 'lilbot_bot_edit', { name: '' })).error).toContain('Give the bot a name')
  await f.call('b1', 'lilbot_primary_set', { botId: other.id })
  expect(primary).toHaveBeenCalledWith(other.id)
  expect((await f.call('b1', 'lilbot_bots_list')).data.bots.find((bot: any) => bot.id === other.id).primary).toBe(true)
  await f.call(other.id, 'lilbot_bot_create', { requestId: 'r', name: 'Made', function: '', instructions: 'Help.' })
  expect(create).toHaveBeenCalledWith(other.id, { requestId: 'r', name: 'Made', function: '', instructions: 'Help.' })
  await f.call('b1', 'lilbot_models_list')
  expect(models).toHaveBeenCalled()
  expect((await f.call('b1', 'lilbot_delete_defaults_get')).data).toEqual({ files: 'archive', privateMemories: 'forget' })
  await f.call('b1', 'lilbot_delete_defaults_set', { files: 'delete', privateMemories: 'keep' })
  expect(setDefaults).toHaveBeenCalledWith({ files: 'delete', privateMemories: 'keep' })
  expect(f.service.deleteDefaults()).toEqual({ files: 'delete', privateMemories: 'keep' })
  expect((await f.call('b1', 'lilbot_delete_defaults_set', { files: 'shred', privateMemories: 'keep' })).error).toContain('Invalid arguments')
})

test('a bot reads its own setup by default and another bot’s by id', async () => {
  const f = systemFixture()
  const other = await addBot(f, 'Other')
  f.store.save({ ...f.store.get(other.id), instructions: 'Other instructions.' })
  const getBot = spyOn(f.service, 'getBot')
  expect((await f.call('b1', 'lilbot_bot_read')).data).toMatchObject({ id: 'b1', name: 'Bot One' })
  expect(getBot).toHaveBeenLastCalledWith('b1')
  expect((await f.call('b1', 'lilbot_bot_read', { botId: other.id })).data).toMatchObject({ id: other.id, instructions: 'Other instructions.' })
  expect(getBot).toHaveBeenLastCalledWith(other.id)
})

test('status and about report computers and the release without credentials, and expose T3 only when enabled', async () => {
  const f = systemFixture()
  const about = (await f.call('b1', 'lilbot_about')).data
  expect(about).toMatchObject({
    release: 'abcdef012345',
    computers: [
      { id: 'leader', name: 'leader-box', online: true, main: false },
      { id: 'mac', name: 'MacBook', online: false, main: true }
    ],
    deploy: { lastFailure: null }
  })
  expect(about.codingThroughT3).toBeUndefined()
  expect((await f.call('b1', 'lilbot_status', { area: 't3' })).error).toContain('Invalid arguments')
  expect((await f.call('b1', 'lilbot_status', { area: 'computers' })).data).toEqual([
    { id: 'leader', name: 'leader-box', os: 'linux', online: true, main: false, lastSeen: '2023-11-14T22:13:20.000Z' },
    { id: 'mac', name: 'MacBook', os: 'darwin', online: false, main: true, lastSeen: '2023-11-14T22:13:20.000Z' }
  ])
  expect((await f.call('b1', 'lilbot_status', { area: 'deploy' })).data).toEqual({ running: 'abcdef012345', latest: null, lastFailure: null })
  expect(JSON.stringify(about)).not.toMatch(/token|key/i)

  const on = systemFixture({ t3Enabled: true })
  expect((await on.call('b1', 'lilbot_about')).data.codingThroughT3).toContain('available, signed in until')
  expect((await on.call('b1', 'lilbot_status', { area: 't3' })).data.state).toBe('connected')
  on.state.t3 = { state: 'expired', expiresAt: 1700000000000 }
  const expired = (await on.call('b1', 'lilbot_status', { area: 't3' })).data
  expect(expired.whatToTellOscar).toContain('expired on 2023-11-14')
})
