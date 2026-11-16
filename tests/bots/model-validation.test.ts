import { expect, test } from 'bun:test'
import { LilBotError } from '../../shared/protocol'
import { fakeService } from '../helpers/fake-engine'

test('refused model edits save nothing and leave the runtime available', async () => {
  const { service, store, engine } = fakeService()
  await service.prepareRuntimes()
  const before = store.get('b1')
  engine.validateModel = async () => {
    throw new LilBotError('invalid_model', 'Choose an available model.')
  }
  engine.applyIdentity = async () => {
    throw new Error('Must not apply a refused edit')
  }
  await expect(service.updateBot({ botId: 'b1', name: 'Changed', instructions: 'Changed', model: { provider: 'bad', model: 'bad' } })).rejects.toThrow('Choose an available model.')
  expect(store.get('b1')).toEqual(before)
  expect((await service.getBot('b1')).runnable).toBe(true)
})

test('a valid replacement repairs an invalid saved model without applying the old identity', async () => {
  const { service, store, engine } = fakeService()
  const valid = { provider: 'p', model: 'valid' }
  store.save({ ...store.get('b1'), model: { provider: 'p', model: 'invalid' } })
  engine.validateModel = async model => {
    expect(model).toEqual(valid)
    expect(store.get('b1').model?.model).toBe('invalid')
  }
  engine.applyIdentity = async (_id, identity) => {
    expect(identity.model).toEqual(valid)
    expect(store.get('b1').model).toEqual(valid)
    return { abilities: [], memoryConnected: false }
  }
  expect((await service.updateBot({ botId: 'b1', model: valid })).runnable).toBe(true)
  expect(store.get('b1').model).toEqual(valid)
})

test('non-model edits keep saving before runtime application', async () => {
  const { service, store, engine } = fakeService()
  engine.validateModel = async () => {
    throw new Error('No model edit')
  }
  engine.applyIdentity = async () => {
    expect(store.get('b1').name).toBe('Renamed')
    return { abilities: [], memoryConnected: false }
  }
  await service.updateBot({ botId: 'b1', name: 'Renamed' })
})
