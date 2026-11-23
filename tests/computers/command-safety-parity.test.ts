import { expect, test } from 'bun:test'
import { checkCommandSafety } from '../../server/computers/command-safety'
import parity from './command-safety-parity.json'

test('matches static hardline parity corpus (blocked)', () => {
  for (const cmd of parity.block) {
    expect(checkCommandSafety(cmd), `expected blocked: ${cmd}`).not.toBeNull()
  }
})

test('matches static hardline parity corpus (allowed)', () => {
  for (const cmd of parity.allow) {
    expect(checkCommandSafety(cmd), `expected allowed: ${cmd}`).toBeNull()
  }
})
