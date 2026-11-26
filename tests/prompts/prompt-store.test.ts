import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPromptOwnershipEnabled, PromptStore } from '../../server/prompts/prompt-store'

const dirs: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-prompt-store-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('PromptStore', () => {
  test('isPromptOwnershipEnabled is off by default and on only for LILBOT_PROMPT_OWNERSHIP=1', () => {
    expect(isPromptOwnershipEnabled({})).toBe(false)
    expect(isPromptOwnershipEnabled({ LILBOT_PROMPT_OWNERSHIP: '0' })).toBe(false)
    expect(isPromptOwnershipEnabled({ LILBOT_PROMPT_OWNERSHIP: 'true' })).toBe(false)
    expect(isPromptOwnershipEnabled({ LILBOT_PROMPT_OWNERSHIP: '1' })).toBe(true)
  })

  test('writes private 0o700 dir and 0o600 file keyed strictly by botId, and removes cleanly on forgetBot', () => {
    const store = new PromptStore(tempDir())
    const path = store.write('bot_01ABC', 'You are a test bot.')
    expect(path).toBe(join(store.dir, 'bot_01ABC.txt'))
    expect(statSync(store.dir).mode & 0o777).toBe(0o700)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8')).toBe('You are a test bot.')

    // Unchanged write keeps the file intact; updated write replaces atomically.
    expect(store.write('bot_01ABC', 'You are a test bot.')).toBe(path)
    expect(store.write('bot_01ABC', 'Updated prompt.')).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe('Updated prompt.')

    store.forgetBot('bot_01ABC')
    expect(existsSync(path)).toBe(false)
    // Safe to repeat when already absent.
    store.forgetBot('bot_01ABC')
  })

  test('rejects invalid bot ids and empty prompts', () => {
    const store = new PromptStore(tempDir())
    expect(() => store.pathFor('../escape')).toThrow()
    expect(() => store.pathFor('Chief of Staff')).toThrow()
    expect(() => store.write('bot-1', '   \n  ')).toThrow()
  })
})
