import { expect, test } from 'bun:test'
import { bot, fakeService } from '../helpers/fake-engine'

test('exactly one primary defaults to the engine default, changes without changing bots, and clears the choice when preferences are forgotten', async () => {
  const { service, store, prefs, changes, log } = fakeService()
  const original = [
    { ...bot, id: 'other' },
    { ...bot, isDefault: true }
  ]
  for (const bot of original) store.save({ ...bot, instructions: '', engineId: 'test', engineBotId: bot.id })
  const primary = async () => (await service.listBots()).filter(bot => bot.isPrimary).map(bot => bot.id)
  expect(await primary()).toEqual(['b1'])
  await service.setPrimary('other')
  expect(await primary()).toEqual(['other'])
  expect((await service.getBot('b1')).isPrimary).toBe(false)
  expect(changes()).toBe(1)
  expect(log).toEqual([])
  expect(original).toEqual([
    { ...bot, id: 'other' },
    { ...bot, isDefault: true }
  ])
  await expect(service.setPrimary('missing')).rejects.toThrow('That bot does not exist.')
  expect(await primary()).toEqual(['other'])
  prefs.forgetBot('other')
  expect(await primary()).toEqual(['b1'])
  expect(prefs.primaryBot()).toBeNull()
  await service.setPrimary('other')
  await service.setPrimary('b1')
  expect(await primary()).toEqual(['b1'])
})

test('losing a runtime leaves the chosen primary identity in place', async () => {
  const { service, runtimeIds } = fakeService()
  await service.setPrimary('b1')
  runtimeIds.delete('b1')
  expect(await service.listBots()).toMatchObject([{ id: 'b1', isPrimary: true, runnable: false }])
})
