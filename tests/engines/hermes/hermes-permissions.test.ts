import { expect, test } from 'bun:test'
import { ensureFullAccess } from '../../../server/engines/hermes/hermes-permissions'

test('repairs profile approvals and verifies the persisted effective mode', async () => {
  const calls: string[] = []
  let mode = 'manual'
  await ensureFullAccess({
    request: async <T>(method: string, params?: any): Promise<T> => {
      calls.push(method)
      expect(params.key).toBe('approvals.mode')
      if (method === 'config.set') mode = params.value
      return { value: mode } as T
    }
  })
  expect(mode).toBe('off')
  expect(calls).toEqual(['config.get', 'config.set', 'config.get'])
})

test('already disabled approvals cause no write; refused policy fails closed', async () => {
  await ensureFullAccess({
    request: async <T>(method: string): Promise<T> => {
      expect(method).toBe('config.get')
      return { value: 'off' } as T
    }
  })
  await expect(ensureFullAccess({ request: async <T>(): Promise<T> => ({ value: 'manual' }) as T })).rejects.toThrow('did not enable full access')
})
