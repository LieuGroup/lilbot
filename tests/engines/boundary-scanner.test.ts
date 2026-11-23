/** Self-tests for the AST boundary scanner: verifies every import dodge, cross-driver isolation,
 *  registration/declaration points, built-string/comment-marker tricks, exact allow-lists, and harmless cases. */
import { describe, expect, test } from 'bun:test'
import { HELPER_REGISTRATION_POINT, isNameExempt, LEADER_DRIVER_DECLARATION, NAME_ALLOWLIST, SERVER_REGISTRATION_POINTS } from './boundary-rules'
import { engineNamesInSource, forbiddenSubfolderImports, relativeImportsInSource } from './boundary-scanner'

describe('boundary scanner self-tests', () => {
  const engines = ['hermes', 'scripted', 'pi'] as const
  const drivers = ['claude-code', 'hermes'] as const

  test('catches static/dynamic/require/re-export/built-string engine imports and product-to-tests imports', () => {
    const engineCases: [string, string][] = [
      ['static import', `import { HermesEngine } from '../engines/hermes/hermes-engine'`],
      ['static re-export', `export { x } from '../engines/hermes/hermes-engine'`],
      ['star re-export', `export * from '../engines/hermes/hermes-memory-setup'`],
      ['type import', `type E = import('../engines/hermes/hermes-engine').HermesEngine`],
      ['dynamic import', `const m = await import('../engines/hermes/hermes-engine')`],
      ['dynamic import built string', `const m = await import('../engines/' + 'hermes' + '/hermes-engine')`],
      ['require', `const m = require('../engines/hermes/hermes-engine')`],
      ['require template', `const m = require(\`../engines/\${"hermes"}/hermes-engine\`)`],
      ['two-letter engine import', `import { run } from '../engines/pi/pi-engine'`]
    ]
    for (const [label, code] of engineCases) {
      const targets = relativeImportsInSource(code, 'server/bots/example.ts')
      expect(forbiddenSubfolderImports('server/bots/example.ts', targets, 'server/engines', engines, SERVER_REGISTRATION_POINTS).length, label).toBeGreaterThan(0)
    }

    const testCases: [string, string][] = [
      ['static import from tests', `import { fakeEngine } from '../../tests/helpers/fake-engine'`],
      ['dynamic import from tests', `const h = await import('../../tests/helpers/fake-engine')`],
      ['require from tests', `const h = require('../../tests/helpers/fake-engine')`]
    ]
    for (const [label, code] of testCases) {
      const targets = relativeImportsInSource(code, 'server/bots/example.ts')
      expect(
        targets.some(t => t === 'tests' || t.startsWith('tests/')),
        label
      ).toBe(true)
    }
  })

  test('enforces helper/drivers/<id>/ isolation, cross-driver bans, and single registration/declaration points', () => {
    const check = (file: string, code: string) => forbiddenSubfolderImports(file, relativeImportsInSource(code, file), 'helper/drivers', drivers, HELPER_REGISTRATION_POINT)

    // Outsiders (including neutral helper files and the leader's declaration point) may not import inside a driver folder.
    expect(check('helper/worker-host.ts', `import { run } from './drivers/hermes/session'`)).toEqual(['helper/worker-host.ts -> helper/drivers/hermes/session'])
    expect(check('helper/worker-host.ts', `const d = await import('./drivers/' + 'claude-code/driver')`)).toEqual(['helper/worker-host.ts -> helper/drivers/claude-code/driver'])
    expect(check(LEADER_DRIVER_DECLARATION, `import { x } from '../../helper/drivers/hermes/driver'`)).toEqual([`${LEADER_DRIVER_DECLARATION} -> helper/drivers/hermes/driver`])
    // Cross-driver imports fail; intra-driver imports pass.
    expect(check('helper/drivers/hermes/session.ts', `import { env } from '../claude-code/env'`)).toEqual(['helper/drivers/hermes/session.ts -> helper/drivers/claude-code/env'])
    expect(check('helper/drivers/hermes/session.ts', `import { proto } from './protocol'`)).toEqual([])
    // Helper's single registration point may import drivers; server's may import server engines (not cross-engine).
    expect(check(HELPER_REGISTRATION_POINT, `import { h } from './hermes/driver'; import { c } from './claude-code/driver'`)).toEqual([])
    expect(
      forbiddenSubfolderImports(
        'server/engines/scripted/scripted-engine.ts',
        relativeImportsInSource(`import { x } from '../hermes/hermes-engine'`, 'server/engines/scripted/scripted-engine.ts'),
        'server/engines',
        engines,
        SERVER_REGISTRATION_POINTS
      )
    ).toEqual(['server/engines/scripted/scripted-engine.ts -> server/engines/hermes/hermes-engine'])
    expect(
      forbiddenSubfolderImports(
        LEADER_DRIVER_DECLARATION,
        relativeImportsInSource(`import { x } from '../engines/hermes/hermes-engine'`, LEADER_DRIVER_DECLARATION),
        'server/engines',
        engines,
        SERVER_REGISTRATION_POINTS
      )
    ).toEqual([`${LEADER_DRIVER_DECLARATION} -> server/engines/hermes/hermes-engine`])

    // Name exemptions cover only engine/driver folders and the registration/declaration points.
    expect(isNameExempt('helper/drivers/hermes/session.ts', engines, drivers)).toBe(true)
    expect(isNameExempt('helper/drivers/claude-code/driver.ts', engines, drivers)).toBe(true)
    expect(isNameExempt(HELPER_REGISTRATION_POINT, engines, drivers)).toBe(true)
    expect(isNameExempt(LEADER_DRIVER_DECLARATION, engines, drivers)).toBe(true)
    for (const point of SERVER_REGISTRATION_POINTS) expect(isNameExempt(point, engines, drivers)).toBe(true)
    expect(isNameExempt('helper/worker-host.ts', engines, drivers)).toBe(false)
    expect(isNameExempt('server/computers/remote-worker-select.ts', engines, drivers)).toBe(false)
  })

  test('catches built strings, comment-marker strings, identifiers, JSX text, and non-label code in allow-listed files', () => {
    const allIds = [...new Set([...engines, ...drivers])]
    const cases: [string, string, string][] = [
      ['concat +', `const x = 'her' + 'mes'`, 'server/bots/a.ts'],
      ['template built', `const x = \`\${"her"}mes\``, 'server/bots/a.ts'],
      ['array join', `const x = ['her', 'mes'].join('')`, 'server/bots/a.ts'],
      ['string.concat', `const x = 'her'.concat('mes')`, 'server/bots/a.ts'],
      ['url // before leak', `const u = 'https://example.test/' + 'hermes'`, 'server/bots/a.ts'],
      ['/* */ strings wrapping leak', `const a = '/*'; const leak = 'hermes'; const b = '*/'`, 'server/bots/a.ts'],
      ['screaming snake config key', `const envKey = process.env.HERMES_HOME`, 'server/bots/a.ts'],
      ['camelCase 2-letter id', `const piEngine = true`, 'server/bots/a.ts'],
      ['property read on non-builtin', `const x = config.pi`, 'server/bots/a.ts'],
      ['JSX text', `export const C = () => <span>Hermes</span>`, 'web/src/a.tsx'],
      ['helper driver id in code', `const fallback = 'claude-code'`, 'helper/worker-host.ts']
    ]
    for (const [label, code, path] of cases) {
      expect(engineNamesInSource(code, path, allIds).length, label).toBeGreaterThan(0)
    }

    const labelAllow = NAME_ALLOWLIST['web/src/computers/coding-engines.ts']
    const okLabel = `const ENGINE_NAMES = { 'claude-code': 'Claude Code', hermes: 'Hermes', codex: 'Codex' }`
    expect(engineNamesInSource(okLabel, 'web/src/computers/coding-engines.ts', allIds, labelAllow)).toEqual([])
    const sneakyBranch = `${okLabel}\nexport const badBranch = (id: string) => id === 'hermes' || id === 'claude-code'`
    expect(engineNamesInSource(sneakyBranch, 'web/src/computers/coding-engines.ts', allIds, labelAllow)).toEqual(['claude-code', 'hermes'])

    const copyAllow = NAME_ALLOWLIST['web/src/computers/command-line-setup.tsx']
    const okCopy = `export const C = () => <p>To run coding workers on this computer, install a coding engine on it (for example, Claude Code) and sign in there. Files and terminal work without it.</p>`
    expect(engineNamesInSource(okCopy, 'web/src/computers/command-line-setup.tsx', allIds, copyAllow)).toEqual([])
    const sneakyCopyFile = `${okCopy}\nexport const isClaude = (d: string) => d === 'claude-code'`
    expect(engineNamesInSource(sneakyCopyFile, 'web/src/computers/command-line-setup.tsx', allIds, copyAllow)).toEqual(['claude-code'])
  })

  test('ignores comments, JS built-in object properties, and harmless substrings', () => {
    const allIds = [...new Set([...engines, ...drivers])]
    const cases: [string, string, string][] = [
      ['line comment', `// hermes scripted pi claude-code\nexport const ok = 1`, 'server/bots/a.ts'],
      ['block comment', `/* hermes, scripted, pi, claude-code */\nexport const ok = 2`, 'server/bots/a.ts'],
      ['builtin object property', `export const c = 2 * Math.PI * 6; export const same = Object.is(1, 1)`, 'web/src/a.tsx'],
      ['prose Unscripted', `export const label = 'Unscripted conversation mode'`, 'web/src/a.tsx'],
      ['substrings api/pipe/copy/topic/expiry', `export const api = 'pipe/copy/topic/expiry'; export function copyApi() { return api }`, 'server/bots/a.ts']
    ]
    for (const [label, code, path] of cases) {
      expect(engineNamesInSource(code, path, allIds), label).toEqual([])
    }
  })
})
