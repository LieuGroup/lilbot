/** Permanent ordinary-work regression corpus: realistic commands coding agents emit must never be refused. */
import { expect, test } from 'bun:test'
import { checkCommandSafety } from '../../server/computers/command-safety'
import ordinary from './command-safety-ordinary.json'

const HOME = '/Users/alice'

test('allows every realistic ordinary command in the permanent corpus', () => {
  expect(ordinary.length).toBeGreaterThanOrEqual(200)
  for (const cmd of ordinary) {
    expect(checkCommandSafety(cmd, HOME), `unexpectedly refused: ${cmd}`).toBeNull()
  }
})
