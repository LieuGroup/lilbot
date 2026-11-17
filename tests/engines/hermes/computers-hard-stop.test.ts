import { expect, test } from 'bun:test'

test('real Hermes hardline detector rejects computer exec before submission', async () => {
  const child = Bun.spawn(['python3', '-B', 'live-checks/computers-hard-stop.py'], { stdout: 'pipe', stderr: 'pipe' })
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
})
