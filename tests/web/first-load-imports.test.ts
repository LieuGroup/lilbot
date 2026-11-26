import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Glob } from 'bun'

/** Client code may take only types from `shown-schema.ts`: a value import would bring zod into the web app's first
 *  load (PR 330 moved it from 211 kB to 236 kB). Its rules live in `shown-rules.ts`, which imports no zod. */
test('client code imports only types from shown-schema, and shown-rules imports no zod', () => {
  const offenders: string[] = []
  for (const root of ['web/src', 'shared/client', 'ios/src'])
    for (const path of new Glob(`${root}/**/*.{ts,tsx}`).scanSync('.')) {
      const text = readFileSync(path, 'utf8')
      for (const line of text.match(/^import [^\n]*shown-schema'/gm) ?? []) if (!line.startsWith('import type ')) offenders.push(`${path}: ${line}`)
    }
  expect(offenders).toEqual([])
  expect(readFileSync('shared/shown-rules.ts', 'utf8')).not.toMatch(/from 'zod'/)
})
