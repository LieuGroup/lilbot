/** North-star boundary guard: no file outside `server/engines/<id>/` and the single registration point
 *  (`server/engines/registry.ts`) may import from any concrete engine or name any concrete engine in code.
 *  Covers `server/`, `shared/`, `web/`, `ios/`, and `helper/` using the TypeScript AST parser. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { concreteEngineIds, engineNamesInSource, importsOf, ROOT, relativeImportsInSource, sourceFiles } from './boundary-scanner'

/** The single place allowed to register concrete server engines. */
const REGISTRATION_POINT = 'server/engines/registry.ts'
const SCANNED_ROOTS = ['server', 'shared', 'web', 'ios', 'helper'] as const

/** Documented UI display labels that intentionally show an engine's display name to the user. */
const DISPLAY_LABEL_ALLOWLIST = new Set(['web/src/computers/coding-engines.ts'])

/** Pre-existing concrete-engine imports outside engine folders and `server/engines/registry.ts`, mapped to the lane clearing them. */
const KNOWN_ENGINE_IMPORT_LEAKS: Record<string, string> = {
  'server/main.ts -> server/engines/hermes/hermes-engine': 'Lane A (P6)',
  'server/main.ts -> server/engines/hermes/hermes-memory-setup': 'Lane A (P5)'
}

/** Pre-existing engine-name leaks outside engine folders, `server/engines/registry.ts`, and `DISPLAY_LABEL_ALLOWLIST`.
 *  Adding a new leak fails CI; fixing a listed file requires removing it here so the ratchet only moves to zero. */
const KNOWN_ENGINE_NAME_LEAKS: Record<string, string> = {
  'helper/worker-probes.ts': 'LILA-36',
  'server/computers/remote-worker-sanitize.ts': 'LILA-36',
  'server/computers/remote-worker-select.ts': 'LILA-36',
  'server/deploy/rollback-profiles.ts': 'Lane A (P5)',
  'server/environment.ts': 'Lane A (P5)',
  'server/main.ts': 'Lane A (P6 + P5)',
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

function filesNamingEngines(engines: readonly string[], allowlist: ReadonlySet<string> = DISPLAY_LABEL_ALLOWLIST): string[] {
  return outsideEngineFiles(engines)
    .filter(file => !allowlist.has(file))
    .filter(file => engineNamesInSource(readFileSync(join(ROOT, file), 'utf8'), file, engines).length > 0)
    .sort()
}

describe('north-star engine boundary guard', () => {
  test('no new file outside engine folders and server/engines/registry.ts imports a concrete engine (ratchet)', () => {
    const engines = concreteEngineIds()
    expect(engines).toContain('scripted')
    expect(concreteImportLeaks(engines)).toEqual(Object.keys(KNOWN_ENGINE_IMPORT_LEAKS).sort())
  })

  test.failing('[Lane A P6 + P5] zero files outside engine folders and server/engines/registry.ts import a concrete engine', () => {
    expect(concreteImportLeaks(concreteEngineIds())).toEqual([])
  })

  test('no new file outside engine folders, registry, and display-label allow-list names any concrete engine (ratchet)', () => {
    const engines = concreteEngineIds()
    expect(filesNamingEngines(engines)).toEqual(Object.keys(KNOWN_ENGINE_NAME_LEAKS).sort())
  })

  test.failing('[Lane A P5/P6 + LILA-36] zero server, shared, or helper files outside engine folders and registry name any concrete engine', () => {
    const hits = filesNamingEngines(concreteEngineIds()).filter(file => file.startsWith('server/') || file.startsWith('shared/') || file.startsWith('helper/'))
    expect(hits).toEqual([])
  })

  test('hypothetical two-letter engine id does not explode across the codebase', () => {
    // Only Math.PI in context-meter.tsx carries the standalone identifier `PI`; ordinary words (`api`, `pipe`, `copy`, `topic`, `expiry`) never match.
    const piHits = filesNamingEngines(['pi'])
    expect(piHits).toEqual(['web/src/history/context-meter.tsx'])
    expect(filesNamingEngines(['fx'])).toEqual([])
  })
})

describe('boundary scanner self-tests', () => {
  const engines = ['hermes', 'scripted', 'pi'] as const

  test('catches static import, re-export, type import, dynamic import, require, and built-string import dodges', () => {
    const cases: [string, string][] = [
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
    for (const [label, code] of cases) {
      const targets = relativeImportsInSource(code, 'server/bots/example.ts')
      expect(
        targets.some(t => engines.some(id => t.startsWith(`server/engines/${id}/`))),
        label
      ).toBe(true)
    }
  })

  test('catches built strings, comment-marker strings, identifiers, and JSX text naming an engine', () => {
    const cases: [string, string, string][] = [
      ['concat +', `const x = 'her' + 'mes'`, 'server/bots/a.ts'],
      ['template built', `const x = \`\${"her"}mes\``, 'server/bots/a.ts'],
      ['array join', `const x = ['her', 'mes'].join('')`, 'server/bots/a.ts'],
      ['string.concat', `const x = 'her'.concat('mes')`, 'server/bots/a.ts'],
      ['url // before leak', `const u = 'https://example.test/' + 'hermes'`, 'server/bots/a.ts'],
      ['/* */ strings wrapping leak', `const a = '/*'; const leak = 'hermes'; const b = '*/'`, 'server/bots/a.ts'],
      ['screaming snake config key', `const envKey = process.env.HERMES_HOME`, 'server/bots/a.ts'],
      ['camelCase 2-letter id', `const piEngine = true`, 'server/bots/a.ts'],
      ['JSX text', `export const C = () => <span>Hermes</span>`, 'web/src/a.tsx']
    ]
    for (const [label, code, path] of cases) {
      expect(engineNamesInSource(code, path, engines).length, label).toBeGreaterThan(0)
    }
  })

  test('ignores comments and harmless English/identifier substrings', () => {
    const cases: [string, string, string][] = [
      ['line comment', `// hermes scripted pi\nexport const ok = 1`, 'server/bots/a.ts'],
      ['block comment', `/* hermes and scripted and pi */\nexport const ok = 2`, 'server/bots/a.ts'],
      ['prose Unscripted', `export const label = 'Unscripted conversation mode'`, 'web/src/a.tsx'],
      ['substrings api/pipe/copy/topic/expiry', `export const api = 'pipe/copy/topic/expiry'; export function copyApi() { return api }`, 'server/bots/a.ts']
    ]
    for (const [label, code, path] of cases) {
      expect(engineNamesInSource(code, path, engines), label).toEqual([])
    }
  })
})
