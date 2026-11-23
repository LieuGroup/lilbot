/** Shared restart harness for engine-agnostic restart-recovery conformance tests. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { startConformanceApp } from './conformance-fixture'

export function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}

export async function waitUntil(check: () => boolean | Promise<boolean>, ms = 6000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return
    await Bun.sleep(40)
  }
  throw new Error('Timed out waiting for restart recovery condition')
}

export async function bootRestartApp(cleanups: (() => void)[], prefix = 'lilbot-restart-conf-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const engine = new ScriptedEngine()
  let current = await startConformanceApp({ dir, engine })
  const stopCurrent = () => {
    engine.disconnectClient()
    current.close()
  }
  cleanups.push(() => stopCurrent())
  const restart = async () => {
    stopCurrent()
    current = await startConformanceApp({ dir, engine })
    return current
  }
  return {
    dir,
    engine,
    get app() {
      return current
    },
    restart
  }
}
