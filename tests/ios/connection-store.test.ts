import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CONNECTION_STORE_MESSAGES, createConnectionStore, type PlainStorage, SETTINGS_KEY, type SecretStorage, TOKEN_KEY } from '../../ios/src/connection/store-core'

function makeMemoryStorage() {
  const plainMap = new Map<string, string>()
  const secretMap = new Map<string, string>()
  const calls = { secretGet: 0, secretSet: 0, secretDelete: 0 }
  const plain: PlainStorage = {
    async getItem(key) {
      return plainMap.get(key) ?? null
    },
    async setItem(key, value) {
      plainMap.set(key, value)
    }
  }
  const secret: SecretStorage = {
    async getItem(key) {
      calls.secretGet += 1
      return secretMap.get(key) ?? null
    },
    async setItem(key, value) {
      calls.secretSet += 1
      secretMap.set(key, value)
    },
    async deleteItem(key) {
      calls.secretDelete += 1
      secretMap.delete(key)
    }
  }
  return { plainMap, secretMap, calls, plain, secret }
}

describe('iOS connection store keychain resilience and Settings rules', () => {
  test('keychain failure on read preserves the saved server address and sets a plain notice', async () => {
    const { plainMap, plain, secret } = makeMemoryStorage()
    plainMap.set(SETTINGS_KEY, JSON.stringify({ serverUrl: 'http://127.0.0.1:3370' }))
    const store = createConnectionStore({
      plain,
      secret: {
        ...secret,
        async getItem() {
          throw new Error('Calling getValueWithKeyAsync failed -> A required entitlement is not present.')
        }
      }
    })

    await store.getState().load()
    expect(store.getState().loaded).toBe(true)
    expect(store.getState().settings).toEqual({ serverUrl: 'http://127.0.0.1:3370', accessToken: '' })
    expect(store.getState().tokenNotice).toBe(CONNECTION_STORE_MESSAGES.readTokenFailed)
    expect(store.getState().tokenNotice).not.toContain('entitlement')
  })

  test('saving with a blank token never writes to keychain and succeeds even if keychain delete fails', async () => {
    const { plainMap, calls, plain, secret } = makeMemoryStorage()
    const store = createConnectionStore({
      plain,
      secret: {
        ...secret,
        async deleteItem() {
          calls.secretDelete += 1
          throw new Error('Keychain unavailable')
        }
      }
    })

    await store.getState().save({ serverUrl: '  http://127.0.0.1:3370  ', accessToken: '   ' })
    expect(calls.secretSet).toBe(0)
    expect(calls.secretDelete).toBe(1)
    expect(plainMap.get(SETTINGS_KEY)).toBe(JSON.stringify({ serverUrl: 'http://127.0.0.1:3370' }))
    expect(store.getState().settings).toEqual({ serverUrl: 'http://127.0.0.1:3370', accessToken: '' })
    expect(store.getState().tokenNotice).toBe('')
  })

  test('keychain failure on write still saves server address and surfaces a plain message instead of raw system error', async () => {
    const { plainMap, plain, secret } = makeMemoryStorage()
    const store = createConnectionStore({
      plain,
      secret: {
        ...secret,
        async setItem() {
          throw new Error("Calling the 'setValueWithKeyAsync' function has failed -> Caused by: A required entitlement is not present.")
        }
      }
    })

    await expect(store.getState().save({ serverUrl: 'https://lilbot.example.com', accessToken: 'secret-jwt' })).rejects.toThrow(CONNECTION_STORE_MESSAGES.saveTokenFailed)
    expect(plainMap.get(SETTINGS_KEY)).toBe(JSON.stringify({ serverUrl: 'https://lilbot.example.com' }))
    expect(store.getState().settings).toEqual({ serverUrl: 'https://lilbot.example.com', accessToken: '' })
    expect(store.getState().tokenNotice).toBe(CONNECTION_STORE_MESSAGES.saveTokenFailed)
    expect(store.getState().tokenNotice).not.toContain('setValueWithKeyAsync')
  })

  test('round-trips address and non-empty token cleanly and clears prior notice', async () => {
    const { plainMap, secretMap, plain, secret } = makeMemoryStorage()
    const store = createConnectionStore({ plain, secret })
    await store.getState().save({ serverUrl: 'https://lilbot.example.com', accessToken: 'tok-123' })
    expect(plainMap.get(SETTINGS_KEY)).toBe(JSON.stringify({ serverUrl: 'https://lilbot.example.com' }))
    expect(secretMap.get(TOKEN_KEY)).toBe('tok-123')
    expect(store.getState().settings).toEqual({ serverUrl: 'https://lilbot.example.com', accessToken: 'tok-123' })

    const reloaded = createConnectionStore({ plain, secret })
    await reloaded.getState().load()
    expect(reloaded.getState().settings).toEqual({ serverUrl: 'https://lilbot.example.com', accessToken: 'tok-123' })
    expect(reloaded.getState().tokenNotice).toBe('')
  })

  test('Settings screen persists taps while keyboard is open and uses ink rather than accent blue on buttons', () => {
    const src = readFileSync(resolve(process.cwd(), 'ios/src/settings/screen.tsx'), 'utf8')
    expect(src).toContain('keyboardShouldPersistTaps="handled"')
    expect(src).toContain('theme.foreground')
    expect(src).not.toContain('theme.primary')
  })
})
