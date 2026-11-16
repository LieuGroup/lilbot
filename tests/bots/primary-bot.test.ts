import { expect, test } from 'bun:test'
import { bot, fakeService } from '../helpers/fake-engine'

test('exactly one primary defaults to the engine default, changes without changing bots, and falls back when missing', async () => {
  const { service, engine, prefs, changes, log } = fakeService()
  const original = [
    { ...bot, id: 'other' },
    { ...bot, isDefault: true }
  ]
  engine.listBots = async () => original
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
  engine.listBots = async () => [original[1]]
  expect(await primary()).toEqual(['b1'])
  engine.listBots = async () => original
  prefs.forgetBot('other')
  expect(await primary()).toEqual(['b1'])
  expect(prefs.primaryBot()).toBeNull()
  await service.setPrimary('other')
  await service.setPrimary('b1')
  expect(await primary()).toEqual(['b1'])
})
