/** Keeps the project map in AGENTS.md true: checks which folders import from which. */
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')

function sourceFiles(folder: string): string[] {
  return readdirSync(join(ROOT, folder)).flatMap(name => {
    const path = join(folder, name)
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

/** The project-relative paths a file imports from (relative imports only). */
function importsOf(file: string): string[] {
  const text = readFileSync(join(ROOT, file), 'utf8')
  return [...text.matchAll(/(?:from|import)\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map(match => normalize(join(dirname(file), match[1])))
}

/** Every import from a file under `from` into `into`, as "file -> target". */
function crossings(from: string, into: string, except: string[] = []): string[] {
  return sourceFiles(from)
    .filter(file => !except.includes(file))
    .flatMap(file =>
      importsOf(file)
        .filter(target => target === into || target.startsWith(`${into}/`))
        .map(target => `${file} -> ${relative('.', target)}`)
    )
}

test('shared holds definitions only: it imports nothing from the server or the web app', () => {
  expect([...crossings('shared', 'server'), ...crossings('shared', 'web')]).toEqual([])
})

test('the web app never reaches into the server', () => {
  expect(crossings('web/src', 'server')).toEqual([])
})

test('only main.ts knows which engine is used: nothing else in the server imports the Hermes engine', () => {
  const outsiders = sourceFiles('server').filter(file => !file.startsWith('server/engines/hermes/') && file !== 'server/main.ts')
  const leaks = outsiders.flatMap(file =>
    importsOf(file)
      .filter(target => target.startsWith('server/engines/hermes'))
      .map(target => `${file} -> ${target}`)
  )
  expect(leaks).toEqual([])
})

test('an engine does not depend on what sits above it', () => {
  expect([
    ...crossings('server/engines', 'server/http'),
    ...crossings('server/engines', 'server/bots'),
    ...crossings('server/engines', 'server/memory'),
    ...crossings('server/engines', 'server/routines'),
    ...crossings('server/engines', 'server/threads')
  ]).toEqual([])
})

test('requests flow downward: memory and bots do not import the http layer, memory does not import bots', () => {
  expect([...crossings('server/memory', 'server/http'), ...crossings('server/bots', 'server/http'), ...crossings('server/memory', 'server/bots')]).toEqual([])
})

test('the database folder is the bottom: it imports nothing else from the server', () => {
  const upward = sourceFiles('server/database').flatMap(file => importsOf(file).filter(target => target.startsWith('server/') && !target.startsWith('server/database')))
  expect(upward).toEqual([])
})

test('routines do not depend on HTTP or a concrete engine', () => {
  expect([...crossings('server/routines', 'server/http'), ...crossings('server/routines', 'server/engines/hermes')]).toEqual([])
})

test('threads depend only on neutral engine contracts and lower services', () => {
  expect([...crossings('server/threads', 'server/http'), ...crossings('server/threads', 'server/bots'), ...crossings('server/threads', 'server/engines/hermes')]).toEqual([])
})
