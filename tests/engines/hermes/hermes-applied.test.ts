import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adapterHash, applied } from '../../../server/engines/hermes/hermes-applied'

let root = ''
let previous: string | undefined
beforeEach(() => {
  previous = process.env.HERMES_HOME
  root = mkdtempSync(join(tmpdir(), 'applied-test-'))
  process.env.HERMES_HOME = root
  mkdirSync(join(root, 'profiles', 'p1'), { recursive: true })
  writeFileSync(join(root, 'profiles', 'p1', 'config.yaml'), 'approvals:\n  mode: "off"\n')
})
afterEach(() => {
  if (previous === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = previous
  rmSync(root, { recursive: true, force: true })
})
const config = () => join(root, 'profiles', 'p1', 'config.yaml')

test('a step runs once per key; a new key, an outside edit or a failed run applies it again', async () => {
  let runs = 0
  const step = (key: string, fail = false) =>
    applied('p1', 'skills', key, async () => {
      runs++
      if (fail) throw new Error('refused')
    })
  expect(await step('a')).toBe(true)
  expect(await step('a')).toBe(false)
  expect(await step('b')).toBe(true)
  await expect(step('c', true)).rejects.toThrow('refused')
  expect(await step('c')).toBe(true)
  writeFileSync(config(), 'approvals:\n  mode: "on"\n')
  expect(await step('c')).toBe(true)
  expect(await step('c')).toBe(false)
  expect(runs).toBe(5)
})

test('a LilBot change to the config keeps the other steps valid; a step edited from outside does not', async () => {
  await applied('p1', 'computers', 'x', async () => {})
  await applied('p1', 'skills', 'y', async () => {})
  await applied('p1', null, '', async () => writeFileSync(config(), 'memory:\n  provider: lilbot\n'))
  expect(await applied('p1', 'computers', 'x', async () => {})).toBe(false)
  expect(await applied('p1', 'skills', 'y', async () => {})).toBe(false)
  writeFileSync(config(), 'memory:\n  provider: other\n')
  expect(await applied('p1', 'computers', 'x', async () => {})).toBe(true)
  expect(await applied('p1', 'skills', 'y', async () => {})).toBe(true)
})

test('steps of one profile take turns, and the record holds hashes only', async () => {
  const order: string[] = []
  const slow = applied('p1', 'one', 'k', async () => {
    await Bun.sleep(20)
    order.push('one')
  })
  const fast = applied('p1', 'two', 'k', async () => void order.push('two'))
  await Promise.all([slow, fast])
  expect(order).toEqual(['one', 'two'])
  const record = readFileSync(join(root, 'profiles', 'p1', 'lilbot-applied.json'), 'utf8')
  expect(JSON.parse(record).steps).toEqual({ one: 'k', two: 'k' })
})

test('adapter hashes follow the shipped files', () => {
  expect(adapterHash('memory-adapter')).toMatch(/^[0-9a-f]{32}$/)
  expect(adapterHash('memory-adapter')).not.toBe(adapterHash('skills-adapter'))
})
