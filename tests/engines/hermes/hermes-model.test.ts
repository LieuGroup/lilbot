import { expect, test } from 'bun:test'
import { HermesEngine } from '../../../server/engines/hermes/hermes-engine'

test('model validation requires both provider and model in the available inventory', async () => {
  const engine = new HermesEngine()
  engine.listModels = async () => [{ provider: 'available', name: 'Available', models: ['known'] }]
  await engine.validateModel({ provider: 'available', model: 'known' })
  await expect(engine.validateModel({ provider: 'available', model: 'unknown' })).rejects.toThrow('not available')
  await expect(engine.validateModel({ provider: 'unknown', model: 'known' })).rejects.toThrow('not available')
})

test('model inventory failures propagate rather than permitting the edit', async () => {
  const engine = new HermesEngine()
  engine.listModels = async () => {
    throw new Error('Engine offline')
  }
  await expect(engine.validateModel({ provider: 'p', model: 'm' })).rejects.toThrow('Engine offline')
})
