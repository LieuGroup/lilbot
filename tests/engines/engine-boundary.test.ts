/** North-star boundary guard: no file outside `server/engines/<id>/` and the single registration point
 *  (`server/engines/registry.ts`) may import from any concrete engine or name any concrete engine in code,
 *  and no product folder (`server/`, `shared/`, `web/`, `ios/`, `helper/`) may import from `tests/`.
 *  Uses the TypeScript AST parser (`tests/engines/boundary-scanner.ts`).
 *
 *  Accepted lexical limits (so this guard is not mistaken for formal proof):
 *  - Names or import paths assembled from runtime variables (`const a = 'her'; a + 'mes'`, `import(varPath)`) are not resolved.
 *  - Odd mixed-case obfuscation (`'HeRmEs'`) or digit-suffixed tokens (`'hermes2'`) are not matched.
 *  - Non-JS/TS config files (`.json`, `.yaml`, `.py`) are outside this scanner's scope. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { concreteEngineIds, type DisplayLabelEntry, engineNamesInSource, importsOf, ROOT, relativeImportsInSource, sourceFiles } from './boundary-scanner'

/** The single place allowed to register concrete server engines. */
const REGISTRATION_POINT = 'server/engines/registry.ts'
const SCANNED_ROOTS = ['server', 'shared', 'web', 'ios', 'helper'] as const

/** Exact UI display-label entries allowed to name an engine (never a whole-file exemption). */
const DISPLAY_LABEL_ALLOWLIST: Record<string, readonly DisplayLabelEntry[]> = {
  'web/src/computers/coding-engines.ts': [{ table: 'ENGINE_NAMES', key: 'hermes', label: 'Hermes' }]
}

/** Pre-existing engine-name leaks outside engine folders, `server/engines/registry.ts`, and exact `DISPLAY_LABEL_ALLOWLIST` entries.
 *  Adding a new leak fails CI; fixing a listed file requires removing it here so the ratchet only moves to zero. */
const KNOWN_ENGINE_NAME_LEAKS: Record<string, string> = {
  'helper/worker-probes.ts': 'LILA-36',
  'server/computers/remote-worker-sanitize.ts': 'LILA-36',
  'server/computers/remote-worker-select.ts': 'LILA-36',
  'server/deploy/rollback-profiles.ts': 'Lane A (P5)',
  'server/environment.ts': 'Lane A (P5)',
  'shared/worker-frame-schema.ts': 'LILA-36'
}

function outsideEngineFiles(engines: readonly string[]): string[] {
  return SCANNED_ROOTS.flatMap(sourceFiles).filter(file => file !== REGISTRATION_POINT && !engines.some(id => file.startsWith(`server/engines/${id}/`)))
}

function concreteImportLeaks(engines: readonly string[]): string[] {
  return outsideEngineFiles(engines)
    .flatMap(file =>
      importsOf(file)
        .filter(target => engines.some(id => target === `server/engines/${id}` || target.startsWith(`server/engines/${id}/`)))
        .map(target => `${file} -> ${relative('.', target)}`)
    )
    .sort()
}

function filesNamingEngines(engines: readonly string[]): string[] {
  return outsideEngineFiles(engines)
    .filter(file => engineNamesInSource(readFileSync(join(ROOT, file), 'utf8'), file, engines, DISPLAY_LABEL_ALLOWLIST[file] ?? []).length > 0)
    .sort()
}

describe('north-star engine boundary guard', () => {
  test('no product file under server, shared, web, ios, or helper imports from tests/', () => {
    const testImports = SCANNED_ROOTS.flatMap(sourceFiles)
      .flatMap(file =>
        importsOf(file)
          .filter(target => target === 'tests' || target.startsWith('tests/'))
          .map(target => `${file} -> ${target}`)
      )
      .sort()
    expect(testImports).toEqual([])
  })

  test('zero files outside engine folders and server/engines/registry.ts import a concrete engine', () => {
    const engines = concreteEngineIds()
    expect(engines).toContain('scripted')
    expect(concreteImportLeaks(engines)).toEqual([])
  })

  test('no new file outside engine folders, registry, and exact display-label entries names any concrete engine (ratchet)', () => {
    const engines = concreteEngineIds()
    expect(filesNamingEngines(engines)).toEqual(Object.keys(KNOWN_ENGINE_NAME_LEAKS).sort())
  })

  test.failing('[Lane A P5 + LILA-36] zero server, shared, or helper files outside engine folders and registry name any concrete engine', () => {
    const hits = filesNamingEngines(concreteEngineIds()).filter(file => file.startsWith('server/') || file.startsWith('shared/') || file.startsWith('helper/'))
    expect(hits).toEqual([])
  })

  test('hypothetical two-letter engine id yields zero false positives across the codebase', () => {
    expect(filesNamingEngines(['pi'])).toEqual([])
    expect(filesNamingEngines(['fx'])).toEqual([])
  })
})

describe('boundary scanner self-tests', () => {
  const engines = ['hermes', 'scripted', 'pi'] as const

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
      expect(
        targets.some(t => engines.some(id => t.startsWith(`server/engines/${id}/`))),
        label
      ).toBe(true)
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

  test('catches built strings, comment-marker strings, identifiers, JSX text, and non-label code in display-label files', () => {
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
      ['JSX text', `export const C = () => <span>Hermes</span>`, 'web/src/a.tsx']
    ]
    for (const [label, code, path] of cases) {
      expect(engineNamesInSource(code, path, engines).length, label).toBeGreaterThan(0)
    }

    const labelAllow = DISPLAY_LABEL_ALLOWLIST['web/src/computers/coding-engines.ts']
    const okLabel = `const ENGINE_NAMES = { hermes: 'Hermes', codex: 'Codex' }`
    expect(engineNamesInSource(okLabel, 'web/src/computers/coding-engines.ts', engines, labelAllow)).toEqual([])
    const sneakyBranch = `${okLabel}\nexport const badBranch = (id: string) => id === 'hermes' || id === 'scripted'`
    expect(engineNamesInSource(sneakyBranch, 'web/src/computers/coding-engines.ts', engines, labelAllow)).toEqual(['hermes', 'scripted'])
  })

  test('ignores comments, JS built-in object properties, and harmless substrings', () => {
    const cases: [string, string, string][] = [
      ['line comment', `// hermes scripted pi\nexport const ok = 1`, 'server/bots/a.ts'],
      ['block comment', `/* hermes and scripted and pi */\nexport const ok = 2`, 'server/bots/a.ts'],
      ['builtin object property', `export const c = 2 * Math.PI * 6; export const same = Object.is(1, 1)`, 'web/src/a.tsx'],
      ['prose Unscripted', `export const label = 'Unscripted conversation mode'`, 'web/src/a.tsx'],
      ['substrings api/pipe/copy/topic/expiry', `export const api = 'pipe/copy/topic/expiry'; export function copyApi() { return api }`, 'server/bots/a.ts']
    ]
    for (const [label, code, path] of cases) {
      expect(engineNamesInSource(code, path, engines), label).toEqual([])
    }
  })
})
