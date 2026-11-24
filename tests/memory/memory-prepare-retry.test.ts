import { describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMemoryPreparation } from '../../server/app-memory'

describe('memory adapter refresh retry on transient failure', () => {
  test('startMemoryPreparation retries thrown errors and per-bot onFailed reports, then stops once clean', async () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      let attempts = 0
      const loop = startMemoryPreparation(
        async onFailed => {
          attempts++
          if (attempts === 1) throw new Error('gateway restarting')
          if (attempts === 2) {
            onFailed('bot-1')
            return
          }
        },
        [10, 10]
      )
      for (let i = 0; i < 40 && attempts < 3; i++) await Bun.sleep(10)
      await Bun.sleep(40)
      loop.stop()
      expect(attempts).toBe(3)
    } finally {
      errSpy.mockRestore()
    }
  })

  test('refreshMemoryAdapters reports transient CLI failures via onFailed and succeeds cleanly on the next pass', async () => {
    const root = mkdtempSync(join(tmpdir(), 'refresh-retry-test-'))
    const marker = join(root, 'failed-once')
    const hermes = join(root, 'hermes')
    const script = join(root, 'run.ts')
    const modulePath = join(import.meta.dir, '../../server/engines/hermes')
    writeFileSync(
      hermes,
      `#!/bin/sh
if [ ! -f '${marker}' ]; then
  touch '${marker}'
  echo "transient gateway lock" >&2
  exit 1
fi
exit 0
`,
      { mode: 0o755 }
    )
    writeFileSync(
      script,
      `
      import { refreshMemoryAdapters } from '${modulePath}/hermes-memory-setup'
      const failed1: string[] = []
      const updated1 = await refreshMemoryAdapters([{ id: 'bot-a', engineBotId: 'owned' }], undefined, id => failed1.push(id))
      const failed2: string[] = []
      const updated2 = await refreshMemoryAdapters([{ id: 'bot-a', engineBotId: 'owned' }], undefined, id => failed2.push(id))
      if (JSON.stringify({ updated1, failed1, updated2, failed2 }) !== JSON.stringify({ updated1: [], failed1: ['owned'], updated2: ['owned'], failed2: [] })) {
        console.error({ updated1, failed1, updated2, failed2 })
        process.exit(1)
      }
      `
    )
    try {
      const home = join(root, 'profiles', 'owned')
      mkdirSync(join(home, 'plugins', 'lilbot-memory-v0-14-0'), { recursive: true })
      writeFileSync(join(home, 'lilbot-memory.json'), JSON.stringify({ url: 'http://127.0.0.1:1', checkpoint_key: 'ckpt-bot-a', bot_id: 'bot-a' }))
      const child = Bun.spawn(['bun', script], { env: { ...process.env, HERMES_HOME: root, LILBOT_HERMES_BIN: hermes }, stdout: 'pipe', stderr: 'pipe' })
      const stderr = await new Response(child.stderr).text()
      expect(await child.exited, stderr).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
