import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CONNECTION_STORE_MESSAGES, createConnectionStore, type PlainStorage, SETTINGS_KEY, type SecretStorage, TOKEN_KEY } from '../../ios/src/connection/store-core'

function makeMemoryStorage() {
  const plainMap = new Map<string, string>()
  const secretMap = new Map<string, string>()
  const calls = { secretGet: 0, secretSet: 0, secretDelete: 0 }
  const plain: PlainStorage = {
    getItem: async key => plainMap.get(key) ?? null,
    setItem: async (key, value) => {
      plainMap.set(key, value)
    }
  }
  const secret: SecretStorage = {
    getItem: async key => {
      calls.secretGet += 1
      return secretMap.get(key) ?? null
    },
    setItem: async (key, value) => {
      calls.secretSet += 1
      secretMap.set(key, value)
    },
    deleteItem: async key => {
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
    plainMap.set(SETTINGS_KEY, JSON.stringify({ serverUrl: 'https://lilbot.example.com' }))
    let failRead = true
    const store = createConnectionStore({
      plain,
      secret: { ...secret, getItem: async key => (failRead ? Promise.reject(new Error('Keychain locked')) : secret.getItem(key)) }
    })
    await store.getState().load()
    expect(store.getState().tokenNotice).toBe(CONNECTION_STORE_MESSAGES.readTokenFailed)

    failRead = false
    await store.getState().save({ serverUrl: 'https://lilbot.example.com', accessToken: 'tok-123' })
    expect(plainMap.get(SETTINGS_KEY)).toBe(JSON.stringify({ serverUrl: 'https://lilbot.example.com' }))
    expect(secretMap.get(TOKEN_KEY)).toBe('tok-123')
    expect(store.getState().settings).toEqual({ serverUrl: 'https://lilbot.example.com', accessToken: 'tok-123' })
    expect(store.getState().tokenNotice).toBe('')
    expect(store.getState().tokenReadFailed).toBe(false)

    const reloaded = createConnectionStore({ plain, secret })
    await reloaded.getState().load()
    expect(reloaded.getState().settings).toEqual({ serverUrl: 'https://lilbot.example.com', accessToken: 'tok-123' })
    expect(reloaded.getState().tokenNotice).toBe('')
  })

  test('retryTokenRead recovers the token after a locked read and is a no-op when the last read succeeded', async () => {
    const { plainMap, secretMap, calls, plain, secret } = makeMemoryStorage()
    plainMap.set(SETTINGS_KEY, JSON.stringify({ serverUrl: 'https://lilbot.example.com' }))
    secretMap.set(TOKEN_KEY, 'stored-jwt')
    let locked = true
    const store = createConnectionStore({
      plain,
      secret: {
        ...secret,
        async getItem(key) {
          if (locked) {
            calls.secretGet += 1
            throw new Error('errSecInteractionNotAllowed')
          }
          return secret.getItem(key)
        }
      }
    })

    await store.getState().load()
    expect(store.getState().tokenReadFailed).toBe(true)
    expect(store.getState().settings).toEqual({ serverUrl: 'https://lilbot.example.com', accessToken: '' })
    expect(calls.secretGet).toBe(1)

    locked = false
    await store.getState().retryTokenRead()
    expect(calls.secretGet).toBe(2)
    expect(store.getState().settings).toEqual({ serverUrl: 'https://lilbot.example.com', accessToken: 'stored-jwt' })
    expect(store.getState().tokenNotice).toBe('')
    expect(store.getState().tokenReadFailed).toBe(false)

    await store.getState().retryTokenRead()
    expect(calls.secretGet).toBe(2)
  })

  test('saving with an untouched blank token while readTokenFailed is active never wipes the stored token', async () => {
    const { plainMap, secretMap, calls, plain, secret } = makeMemoryStorage()
    plainMap.set(SETTINGS_KEY, JSON.stringify({ serverUrl: 'https://old.example.com' }))
    secretMap.set(TOKEN_KEY, 'stored-jwt')
    let locked = true
    const store = createConnectionStore({
      plain,
      secret: { ...secret, getItem: async key => (locked ? Promise.reject(new Error('errSecInteractionNotAllowed')) : secret.getItem(key)) }
    })

    await store.getState().load()
    expect(store.getState().tokenReadFailed).toBe(true)

    await store.getState().save({ serverUrl: 'https://new.example.com', accessToken: '' })
    expect(calls.secretDelete).toBe(0)
    expect(secretMap.get(TOKEN_KEY)).toBe('stored-jwt')
    expect(plainMap.get(SETTINGS_KEY)).toBe(JSON.stringify({ serverUrl: 'https://new.example.com' }))
    expect(store.getState().tokenReadFailed).toBe(true)
    expect(store.getState().tokenNotice).toBe(CONNECTION_STORE_MESSAGES.readTokenFailed)

    locked = false
    await store.getState().retryTokenRead()
    expect(store.getState().settings).toEqual({ serverUrl: 'https://new.example.com', accessToken: 'stored-jwt' })
    expect(store.getState().tokenNotice).toBe('')

    await store.getState().save({ serverUrl: 'https://new.example.com', accessToken: '' }, { clearToken: true })
    expect(calls.secretDelete).toBe(1)
    expect(secretMap.has(TOKEN_KEY)).toBe(false)
  })

  test('Settings screen and AppGate wire foreground token retry, untouched-token guard, keyboard taps, and ink buttons', () => {
    const screenSrc = readFileSync(resolve(process.cwd(), 'ios/src/settings/screen.tsx'), 'utf8')
    const serverSrc = readFileSync(resolve(process.cwd(), 'ios/src/settings/server-section.tsx'), 'utf8')
    const layoutSrc = readFileSync(resolve(process.cwd(), 'ios/src/app/_layout.tsx'), 'utf8')
    expect(screenSrc).toContain('keyboardShouldPersistTaps="handled"')
    expect(serverSrc).toContain('clearToken: tokenEdited')
    expect(serverSrc).toContain('theme.foreground')
    expect(screenSrc).not.toContain('theme.primary')
    expect(serverSrc).not.toContain('theme.primary')
    expect(layoutSrc).toContain("AppState.addEventListener('change'")
    expect(layoutSrc).toContain('retryTokenRead')
  })
})
