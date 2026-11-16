import { expect, test } from 'bun:test'
import { applyIdentity, createRuntime } from '../../../server/engines/hermes/hermes-runtime'
import { detail } from '../../helpers/fake-engine'

function socket(result = { ok: true }) {
  const calls: { method: string; params: unknown }[] = []
  return {
    calls,
    request: async <T>(method: string, params?: unknown): Promise<T> => {
      calls.push({ method, params })
      return result as T
    }
  }
}

test('creation uses the supplied id, instructions and model without writing ui_meta', async () => {
  const client = socket()
  const identity = { ...detail, id: crypto.randomUUID(), model: { provider: 'p', model: 'm' } }
  expect(await createRuntime(client, identity)).toBe(identity.id)
  expect(client.calls).toEqual([
    {
      method: 'profiles.create',
      params: {
        name: identity.id,
        description: '',
        soul: '',
        no_alias: true,
        clone_from: 'default',
        model: 'm',
        provider: 'p'
      }
    }
  ])
})

test('app settings repair drift, and an unchanged profile or name-only edit causes no write', async () => {
  const client = socket()
  await applyIdentity(client, 'native', { ...detail, name: 'Renamed' }, detail)
  expect(client.calls).toEqual([])
  await applyIdentity(client, 'native', { ...detail, function: 'Work', instructions: 'New', model: { provider: 'p', model: 'm' } }, detail)
  expect(client.calls).toEqual([{ method: 'profiles.configure', params: { name: 'native', description: 'Work', soul: 'New', model: 'm', provider: 'p' } }])
  await expect(applyIdentity(socket({ ok: false }), 'native', { ...detail, instructions: 'New' }, detail)).rejects.toThrow('did not apply')
})
