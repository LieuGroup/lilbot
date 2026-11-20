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
    ...crossings('server/engines', 'server/threads'),
    ...crossings('server/engines', 'server/attachments'),
    ...crossings('server/engines', 'server/devices'),
    ...crossings('server/engines', 'server/system'),
    ...crossings('server/engines', 'server/webhooks')
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

test('webhooks do not depend on HTTP, the system server or a concrete engine', () => {
  expect([...crossings('server/webhooks', 'server/http'), ...crossings('server/webhooks', 'server/system'), ...crossings('server/webhooks', 'server/engines/hermes')]).toEqual([])
})

test('threads depend only on neutral engine contracts and lower services', () => {
  expect([...crossings('server/threads', 'server/http'), ...crossings('server/threads', 'server/bots'), ...crossings('server/threads', 'server/engines/hermes')]).toEqual([])
})

test('computers are engine-neutral and never depend on HTTP or bot service', () => {
  expect([...crossings('server/computers', 'server/http'), ...crossings('server/computers', 'server/bots'), ...crossings('server/computers', 'server/engines/hermes')]).toEqual([])
  expect([...crossings('helper', 'server'), ...crossings('helper', 'web')]).toEqual([])
})

test('attachments do not depend on HTTP or a concrete engine', () => {
  expect([...crossings('server/attachments', 'server/http'), ...crossings('server/attachments', 'server/engines/hermes')]).toEqual([])
})

test('history depends on neutral engine contracts and storage, not HTTP or bot orchestration', () => {
  expect([...crossings('server/history', 'server/http'), ...crossings('server/history', 'server/bots'), ...crossings('server/history', 'server/engines/hermes')]).toEqual([])
})

test('the system server and the note work for every engine: no HTTP layer, no concrete engine, and bots never import it', () => {
  expect([
    ...crossings('server/system', 'server/http'),
    ...crossings('server/system', 'server/engines/hermes'),
    ...crossings('server/bots', 'server/system'),
    ...crossings('server/memory', 'server/system')
  ]).toEqual([])
})

test('the work board is engine-neutral and below the bots: no HTTP, bots, system, threads, routines or concrete engine; nothing below imports it', () => {
  expect([
    ...crossings('server/work', 'server/http'),
    ...crossings('server/work', 'server/bots'),
    ...crossings('server/work', 'server/system'),
    ...crossings('server/work', 'server/threads'),
    ...crossings('server/work', 'server/routines'),
    ...crossings('server/work', 'server/engines'),
    ...crossings('server/threads', 'server/work'),
    ...crossings('server/routines', 'server/work'),
    ...crossings('server/bots', 'server/work')
  ]).toEqual([])
})

test('devices sit on computers and neutral engine contracts: no HTTP, bots, system or concrete engine; computers and bots never import them; routines and threads take only the pure origin lines', () => {
  expect([
    ...crossings('server/devices', 'server/http'),
    ...crossings('server/devices', 'server/bots'),
    ...crossings('server/devices', 'server/system'),
    ...crossings('server/devices', 'server/engines/hermes'),
    ...crossings('server/computers', 'server/devices'),
    ...crossings('server/bots', 'server/devices')
  ]).toEqual([])
  const lines = [...crossings('server/routines', 'server/devices'), ...crossings('server/threads', 'server/devices')]
  expect(lines.length).toBeGreaterThan(0)
  expect(lines.filter(line => !line.endsWith('-> server/devices/origin-line'))).toEqual([])
})

test('goals sit on the work board and routines: no HTTP, bots, system, threads or engines; nothing below imports them', () => {
  expect([
    ...crossings('server/goals', 'server/http'),
    ...crossings('server/goals', 'server/bots'),
    ...crossings('server/goals', 'server/system'),
    ...crossings('server/goals', 'server/threads'),
    ...crossings('server/goals', 'server/engines'),
    ...crossings('server/work', 'server/goals'),
    ...crossings('server/routines', 'server/goals'),
    ...crossings('server/threads', 'server/goals'),
    ...crossings('server/bots', 'server/goals')
  ]).toEqual([])
})
