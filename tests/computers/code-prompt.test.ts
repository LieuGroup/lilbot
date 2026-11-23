import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HelperUserError, INVALID_CODE_MESSAGE, NO_CODE_MESSAGE, parseInstallCode, readInstallCode } from '../../helper/code-prompt'

const VALID_CODE = `${'A'.repeat(32)}.${'a'.repeat(64)}`

test('parseInstallCode accepts only exact one-time codes and rejects commands or short strings', () => {
  expect(parseInstallCode(VALID_CODE)).toBe(VALID_CODE)
  expect(parseInstallCode(`  ${VALID_CODE}\n`)).toBe(VALID_CODE)
  for (const bad of [
    '',
    '   ',
    'A'.repeat(32),
    `printf '%s' '${VALID_CODE}' | ./lilbot-helper install https://door.example`,
    'curl -fsSL https://bot.example/api/computers/download/lilbot-helper-linux-x64.tar.gz',
    `${'A'.repeat(32)}.${'g'.repeat(64)}`
  ])
    expect(parseInstallCode(bad)).toBeNull()
})

test('piped stdin accepts a valid code and rejects a pasted command without echoing it', async () => {
  expect(await readInstallCode({ isTTY: false, readPipe: async () => `${VALID_CODE}\n` })).toBe(VALID_CODE)
  const secretLike = 'printf secret_token_123 | ./lilbot-helper install https://door.example'
  let caught: unknown
  try {
    await readInstallCode({ isTTY: false, readPipe: async () => secretLike })
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(HelperUserError)
  expect((caught as Error).message).toBe(INVALID_CODE_MESSAGE)
  expect((caught as Error).message).not.toContain('secret_token_123')
})

test('interactive TTY prompt rejects a pasted command with a plain message and accepts a retry', async () => {
  const out: string[] = []
  const inputs = ['curl -fsSL https://example.com | sh', VALID_CODE]
  const code = await readInstallCode({
    isTTY: true,
    readTtyLine: () => inputs.shift() ?? null,
    write: text => void out.push(text)
  })
  expect(code).toBe(VALID_CODE)
  const joined = out.join('')
  expect(joined).toContain('Paste only the one-time code from LilBot')
  expect(joined).toContain(INVALID_CODE_MESSAGE)
  expect(joined).not.toContain(VALID_CODE)
})

test('interactive TTY prompt stops cleanly after three invalid attempts', async () => {
  const out: string[] = []
  let calls = 0
  await expect(
    readInstallCode({
      isTTY: true,
      readTtyLine: () => {
        calls++
        return 'not-a-code'
      },
      write: text => void out.push(text)
    })
  ).rejects.toThrow(NO_CODE_MESSAGE)
  expect(calls).toBe(3)
})

test('real PTY hides the typed code, explains a pasted command, and restores terminal echo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'code-prompt-pty-'))
  try {
    // Runs helper/main.ts in a real PTY via python3, pastes a command first (rejected), then a syntactically valid
    // code (never echoed back), hits a dead local port so registration fails, and prints whether ECHO was restored.
    const helper = join(import.meta.dir, '../../helper/main.ts')
    const fakeCode = `${'B'.repeat(32)}.${'b'.repeat(64)}`
    const script = `
import os, pty, select, subprocess, termios, time
master, slave = pty.openpty()
env = dict(os.environ, LILBOT_HELPER_CONFIG_DIR=${JSON.stringify(root)})
p = subprocess.Popen(['bun', ${JSON.stringify(helper)}, 'register', 'http://127.0.0.1:1'], stdin=slave, stdout=slave, stderr=slave, env=env, close_fds=True)
os.close(slave)
buf = b''
def read_until(needle, timeout=5.0):
    global buf
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.1)
        if r:
            try:
                chunk = os.read(master, 4096)
                if not chunk: break
                buf += chunk
                if needle in buf: return True
            except OSError:
                break
    return False
assert read_until(b'Paste only the one-time code'), buf
os.write(master, b'curl https://example.com\\n')
assert read_until(b'That does not look like a one-time code'), buf
os.write(master, (${JSON.stringify(fakeCode)} + '\\n').encode())
p.wait(timeout=10)
while True:
    r, _, _ = select.select([master], [], [], 0.1)
    if not r: break
    try:
        chunk = os.read(master, 4096)
        if not chunk: break
        buf += chunk
    except OSError:
        break
echo_on = bool(termios.tcgetattr(master)[3] & termios.ECHO)
os.close(master)
print('EXIT=' + str(p.returncode))
print('ECHO=' + str(echo_on))
print('OUT=' + buf.decode('utf-8', 'replace'))
`
    const run = Bun.spawn(['python3', '-c', script], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited])
    expect(exitCode, stderr).toBe(0)
    expect(stdout).toContain('EXIT=1')
    expect(stdout).toContain('ECHO=True')
    expect(stdout).toContain(INVALID_CODE_MESSAGE)
    expect(stdout).toContain('Registration was refused.')
    expect(stdout).not.toContain(fakeCode)
    expect(stdout).not.toContain('curl https://example.com')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
