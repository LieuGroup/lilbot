/** Keeps the project map in AGENTS.md true: checks which folders import from which (via TypeScript AST). */
import { expect, test } from 'bun:test'
import { relative } from 'node:path'
import { concreteDriverIds, concreteEngineIds, forbiddenSubfolderImports, importsOf, sourceFiles } from './engines/boundary-scanner'

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

/** Every import from `from` into any concrete engine folder under `server/engines/<id>/`. */
function concreteEngineCrossings(from: string, except: string[] = []): string[] {
  return concreteEngineIds().flatMap(id => crossings(from, `server/engines/${id}`, except))
}

test('shared holds protocol definitions and shared client logic: it imports nothing from server, web, ios or helper', () => {
  expect([...crossings('shared', 'server'), ...crossings('shared', 'web'), ...crossings('shared', 'ios'), ...crossings('shared', 'helper')]).toEqual([])
})

test('server and helper never import client-only code from shared/client/', () => {
  expect([...crossings('server', 'shared/client'), ...crossings('helper', 'shared/client')]).toEqual([])
})

test('the web and iOS apps never reach into the server', () => {
  expect([...crossings('web/src', 'server'), ...crossings('ios/src', 'server')]).toEqual([])
})

test('product code never imports from tests/', () => {
  expect(['server', 'shared', 'web', 'ios', 'helper'].flatMap(root => crossings(root, 'tests'))).toEqual([])
})

test('only the single engine registration point knows which engines exist: nothing else in the server imports a concrete engine', () => {
  const engines = concreteEngineIds()
  const leaks = sourceFiles('server')
    .flatMap(file => forbiddenSubfolderImports(file, importsOf(file), 'server/engines', engines, 'server/engines/registry.ts'))
    .sort()
  expect(leaks).toEqual([])
})

test('only helper/drivers/registry.ts imports concrete helper drivers, and drivers never import each other', () => {
  const drivers = concreteDriverIds()
  const leaks = ['server', 'shared', 'web', 'ios', 'helper']
    .flatMap(sourceFiles)
    .flatMap(file => forbiddenSubfolderImports(file, importsOf(file), 'helper/drivers', drivers, 'helper/drivers/registry.ts'))
    .sort()
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
  expect([...crossings('server/routines', 'server/http'), ...concreteEngineCrossings('server/routines')]).toEqual([])
})

test('webhooks do not depend on HTTP, the system server or a concrete engine', () => {
  expect([...crossings('server/webhooks', 'server/http'), ...crossings('server/webhooks', 'server/system'), ...concreteEngineCrossings('server/webhooks')]).toEqual([])
})

test('threads depend only on neutral engine contracts and lower services', () => {
  expect([...crossings('server/threads', 'server/http'), ...crossings('server/threads', 'server/bots'), ...concreteEngineCrossings('server/threads')]).toEqual([])
})

test('computers are engine-neutral and never depend on HTTP or bot service', () => {
  expect([...crossings('server/computers', 'server/http'), ...crossings('server/computers', 'server/bots'), ...concreteEngineCrossings('server/computers')]).toEqual([])
  expect([...crossings('helper', 'server'), ...crossings('helper', 'web')]).toEqual([])
})

test('attachments do not depend on HTTP or a concrete engine', () => {
  expect([...crossings('server/attachments', 'server/http'), ...concreteEngineCrossings('server/attachments')]).toEqual([])
})

test('history depends on neutral engine contracts and storage, not HTTP or bot orchestration', () => {
  expect([...crossings('server/history', 'server/http'), ...crossings('server/history', 'server/bots'), ...concreteEngineCrossings('server/history')]).toEqual([])
})

test('the system server and the note work for every engine: no HTTP layer, no concrete engine, and bots never import it', () => {
  expect([
    ...crossings('server/system', 'server/http'),
    ...concreteEngineCrossings('server/system'),
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
    ...concreteEngineCrossings('server/devices'),
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

test('connections work for every engine and sit below the bots: no HTTP, bots, system or concrete engine; bots never import them', () => {
  expect([
    ...crossings('server/connections', 'server/http'),
    ...crossings('server/connections', 'server/bots'),
    ...crossings('server/connections', 'server/system'),
    ...concreteEngineCrossings('server/connections'),
    ...crossings('server/bots', 'server/connections')
  ]).toEqual([])
})
