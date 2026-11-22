import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const detector = join(homedir(), '.hermes/hermes-agent/tools/approval_detection.py')

describe.skipIf(!existsSync(detector))('Hermes hard stop', () => {
  test('real Hermes hardline detector rejects computer exec before submission', async () => {
    const child = Bun.spawn(['python3', '-B', 'live-checks/computers-hard-stop.py'], { stdout: 'pipe', stderr: 'pipe' })
    const error = await new Response(child.stderr).text()
    expect(await child.exited, error).toBe(0)
  })
})
