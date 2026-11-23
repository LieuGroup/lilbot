/** North-star boundary guard:
 *  - Server engines live under `server/engines/<id>/` and register only in `server/engines/registry.ts`.
 *  - Helper drivers live under `helper/drivers/<id>/`, register only in `helper/drivers/registry.ts`,
 *    and are declared on the leader only in `server/computers/remote-worker-drivers.ts`.
 *  - No file outside an engine/driver's own folder and its registration point may import into it (including
 *    cross-engine and cross-driver imports), no product folder may import from `tests/`, and no file outside
 *    those folders, the three registration/declaration points, and exact display/copy allow-lists may name any
 *    server engine or helper driver id.
 *
 *  Accepted lexical limits (so this guard is not mistaken for formal proof):
 *  - Names or import paths assembled from runtime variables (`const a = 'her'; a + 'mes'`, `import(varPath)`) are not resolved.
 *  - Odd mixed-case obfuscation (`'HeRmEs'`) or digit-suffixed tokens (`'hermes2'`) are not matched.
 *  - Non-JS/TS config and markdown guide/skill files (`.json`, `.yaml`, `.py`, `.md`) are outside this scanner's scope and left to review. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HELPER_REGISTRATION_POINT, isNameExempt, NAME_ALLOWLIST, SCANNED_ROOTS, SERVER_REGISTRATION_POINT } from './boundary-rules'
import { allEngineAndDriverIds, concreteDriverIds, concreteEngineIds, engineNamesInSource, forbiddenSubfolderImports, importsOf, ROOT, sourceFiles } from './boundary-scanner'

function concreteImportLeaks(engines: readonly string[]): string[] {
  return SCANNED_ROOTS.flatMap(sourceFiles)
    .flatMap(file => forbiddenSubfolderImports(file, importsOf(file), 'server/engines', engines, SERVER_REGISTRATION_POINT))
    .sort()
}

function concreteDriverImportLeaks(drivers: readonly string[]): string[] {
  return SCANNED_ROOTS.flatMap(sourceFiles)
    .flatMap(file => forbiddenSubfolderImports(file, importsOf(file), 'helper/drivers', drivers, HELPER_REGISTRATION_POINT))
    .sort()
}

function filesNamingIds(ids: readonly string[], engines = concreteEngineIds(), drivers = concreteDriverIds()): string[] {
  return SCANNED_ROOTS.flatMap(sourceFiles)
    .filter(file => !isNameExempt(file, engines, drivers))
    .filter(file => engineNamesInSource(readFileSync(join(ROOT, file), 'utf8'), file, ids, NAME_ALLOWLIST[file]).length > 0)
    .sort()
}

describe('north-star engine & helper driver boundary guard', () => {
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

  test('zero files outside a helper driver folder and helper/drivers/registry.ts import from any helper driver folder', () => {
    expect(concreteDriverImportLeaks(concreteDriverIds())).toEqual([])
  })

  test('zero files outside engine/driver folders, registration/declaration points, and exact allow-lists name any engine or driver', () => {
    expect(filesNamingIds(allEngineAndDriverIds())).toEqual([])
  })

  test('zero server, shared, or helper files outside engine/driver folders and registration points name any engine or driver', () => {
    const hits = filesNamingIds(allEngineAndDriverIds()).filter(file => file.startsWith('server/') || file.startsWith('shared/') || file.startsWith('helper/'))
    expect(hits).toEqual([])
  })

  test('hypothetical two-letter engine id yields zero false positives across the codebase', () => {
    expect(filesNamingIds(['pi'])).toEqual([])
    expect(filesNamingIds(['fx'])).toEqual([])
  })

  test('hypothetical helper driver id (claude-code) flags zero UI files once display-label and example-copy allow-lists apply', () => {
    const uiHits = filesNamingIds(['claude-code'], concreteEngineIds(), ['claude-code']).filter(file => file.startsWith('web/') || file.startsWith('ios/'))
    expect(uiHits).toEqual([])
  })
})
