/** North-star structure rule: no file outside `server/engines/<engine>/` (and the one registration point)
 *  may import from any concrete engine or name any concrete engine in code. Covers `server/`, `shared/`, `web/src/`, and `ios/`. */
import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'

const ROOT = join(import.meta.dir, '../..')

/** The single place allowed to register concrete server engines (moves from `server/main.ts` to `server/engines/registry.ts` in Lane A P6). */
const REGISTRATION_POINTS = new Set(['server/main.ts', 'server/engines/registry.ts'])

/** Known pre-existing engine-name leaks outside engine folders & registry, mapped to the lane that clears them.
 *  Adding a new leak fails CI; fixing a listed file requires removing it here so the ratchet only moves to zero. */
const KNOWN_ENGINE_NAME_LEAKS: Record<string, string> = {
  'server/environment.ts': 'Lane A (P5)',
  'server/deploy/rollback-profiles.ts': 'Lane A (P5)',
  'server/computers/remote-worker-sanitize.ts': 'LILA-36',
  'server/computers/remote-worker-select.ts': 'LILA-36',
  'shared/worker-frame-schema.ts': 'LILA-36',
  'web/src/computers/coding-engines.ts': 'UI display labels for remote coding workers'
}

function engineIds(): string[] {
  const dir = join(ROOT, 'server/engines')
  return readdirSync(dir)
    .filter(name => statSync(join(dir, name)).isDirectory())
    .sort()
}

function sourceFiles(folder: string): string[] {
  const full = join(ROOT, folder)
  if (!existsSync(full)) return []
  return readdirSync(full).flatMap(name => {
    if (name === 'node_modules' || name === 'dist' || name === '.expo') return []
    const path = join(folder, name)
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path)
    return /\.[cm]?[jt]sx?$/.test(name) ? [path] : []
  })
}

function importsOf(file: string): string[] {
  const text = readFileSync(join(ROOT, file), 'utf8')
  return [...text.matchAll(/(?:from|import)\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map(match => normalize(join(dirname(file), match[1])))
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function outsideEngineFiles(engines: string[]): string[] {
  const roots = ['server', 'shared', 'web/src', 'ios']
  return roots.flatMap(sourceFiles).filter(file => !REGISTRATION_POINTS.has(file) && !engines.some(id => file.startsWith(`server/engines/${id}/`)))
}

function filesNamingEngines(engines: string[]): string[] {
  const pattern = new RegExp(engines.join('|'), 'i')
  return outsideEngineFiles(engines)
    .filter(file => pattern.test(stripComments(readFileSync(join(ROOT, file), 'utf8'))))
    .sort()
}

test('no file outside an engine folder and the single registration point imports from any concrete engine', () => {
  const engines = engineIds()
  expect(engines).toContain('scripted')
  const leaks = outsideEngineFiles(engines).flatMap(file =>
    importsOf(file)
      .filter(target => engines.some(id => target === `server/engines/${id}` || target.startsWith(`server/engines/${id}/`)))
      .map(target => `${file} -> ${relative('.', target)}`)
  )
  expect(leaks).toEqual([])
})

test('no new file outside engine folders and the registration point may name any concrete engine (ratchet)', () => {
  const engines = engineIds()
  const found = filesNamingEngines(engines)
  expect(found).toEqual(Object.keys(KNOWN_ENGINE_NAME_LEAKS).sort())
})

test.failing('[Lane A P5 + LILA-36] zero server or shared files outside engine folders and registry name any concrete engine', () => {
  const engines = engineIds()
  const serverOrShared = filesNamingEngines(engines).filter(file => file.startsWith('server/') || file.startsWith('shared/'))
  expect(serverOrShared).toEqual([])
})
