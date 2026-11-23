import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INVALID_CODE_MESSAGE, NO_CODE_MESSAGE } from '../../helper/code-prompt'
import { buildPrivateCommand } from '../../web/src/computers/command-line-script'

const HELPER = join(import.meta.dir, '../../helper/main.ts')
const REAL_COMMAND = buildPrivateCommand({
  privateOrigin: 'https://bot.tailnet.example:8443',
  download: { fileName: 'lilbot-helper-linux-x64.tar.gz', sha256: '0123456789abcdef'.repeat(4), os: 'linux' },
  helperUrl: 'https://connect.lilbot.example'
})!

async function runPython(script: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['python3', '-c', script], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout, stderr, exitCode }
}

test('external SIGTERM, SIGINT and SIGHUP interrupt the hidden prompt at once, restore echo/icanon, and run subshell temp cleanup', async () => {
  for (const [sig, expectedRc] of [
    ['SIGTERM', 143],
    ['SIGINT', 130],
    ['SIGHUP', 129]
  ] as const) {
    const root = mkdtempSync(join(tmpdir(), `code-prompt-sig-${sig}-`))
    try {
      const bashCmd = `( set -e; umask 077; d=$(mktemp -d "${root}/lilbot-helper.XXXXXX"); trap 'rm -rf "$d"' EXIT INT TERM; printf 'TMPDIR=%s\\n' "$d"; bun ${JSON.stringify(HELPER)} register 'http://127.0.0.1:1' )`
      const script = `
import os, pty, re, select, signal, subprocess, termios, time
master, slave = pty.openpty()
env = dict(os.environ, LILBOT_HELPER_CONFIG_DIR=${JSON.stringify(root)})
p = subprocess.Popen(['bash', '-c', ${JSON.stringify(bashCmd)}], stdin=slave, stdout=slave, stderr=slave, env=env, close_fds=True)
os.close(slave)
buf = b''
def read_until(needle, timeout=5.0):
    global buf
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.05)
        if r:
            try:
                chunk = os.read(master, 4096)
                if not chunk: break
                buf += chunk
                if needle in buf: return True
            except OSError:
                break
    return False
def descendants(pid):
    out = []
    try:
        for c in subprocess.check_output(['pgrep', '-P', str(pid)]).decode().split():
            out.append(int(c))
            out.extend(descendants(int(c)))
    except subprocess.CalledProcessError:
        pass
    return out
assert read_until(b'Paste only the one-time code'), buf
during = termios.tcgetattr(master)[3]
during_echo = bool(during & termios.ECHO)
during_icanon = bool(during & termios.ICANON)
helper_pid = descendants(p.pid)[-1]
os.kill(helper_pid, signal.${sig})
rc = p.wait(timeout=4)
while True:
    r, _, _ = select.select([master], [], [], 0.05)
    if not r: break
    try:
        chunk = os.read(master, 4096)
        if not chunk: break
        buf += chunk
    except OSError:
        break
after = termios.tcgetattr(master)[3]
after_echo = bool(after & termios.ECHO)
after_icanon = bool(after & termios.ICANON)
os.close(master)
m = re.search(rb'TMPDIR=(\\S+)', buf)
print('DURING_ECHO=' + str(during_echo))
print('DURING_ICANON=' + str(during_icanon))
print('AFTER_ECHO=' + str(after_echo))
print('AFTER_ICANON=' + str(after_icanon))
print('RC=' + str(rc))
print('DIR=' + (m.group(1).decode() if m else ''))
`
      const { stdout, stderr, exitCode } = await runPython(script)
      expect(exitCode, `${sig}: ${stderr}`).toBe(0)
      expect(stdout).toContain('DURING_ECHO=False')
      expect(stdout).toContain('DURING_ICANON=False')
      expect(stdout).toContain('AFTER_ECHO=True')
      expect(stdout).toContain('AFTER_ICANON=True')
      expect(stdout).toContain(`RC=${expectedRc}`)
      const dir = stdout.match(/DIR=(.+)/)?.[1]?.trim() ?? ''
      expect(dir.startsWith(root)).toBe(true)
      expect(existsSync(dir)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}, 25_000)

test('pasting the 6-line command counts as one attempt (both raw and bracketed) and never leaks into the parent shell', async () => {
  const root = mkdtempSync(join(tmpdir(), 'code-prompt-paste-'))
  const fakeCode = `${'C'.repeat(32)}.${'c'.repeat(64)}`
  try {
    const checkTty = `python3 -c "import termios; a=termios.tcgetattr(0)[3]; print('POST_TTY', bool(a&termios.ECHO), bool(a&termios.ICANON))"`
    const script = `
import os, pty, select, subprocess, time
master, slave = pty.openpty()
env = dict(os.environ, LILBOT_HELPER_CONFIG_DIR=${JSON.stringify(root)}, PS1='READY_SHELL> ', TERM='xterm-256color')
p = subprocess.Popen(['bash', '--norc', '--noprofile', '-i'], stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True, close_fds=True)
os.close(slave)
buf = b''
def read_until(needle, count=1, timeout=6.0):
    global buf
    end = time.time() + timeout
    while time.time() < end:
        if buf.count(needle) >= count: return True
        r, _, _ = select.select([master], [], [], 0.05)
        if r:
            try:
                chunk = os.read(master, 4096)
                if not chunk: break
                buf += chunk
            except OSError:
                break
    return buf.count(needle) >= count

cmd = ${JSON.stringify(REAL_COMMAND)} + '\\n'
bracketed = '\\x1b[200~' + ${JSON.stringify(REAL_COMMAND)} + '\\x1b[201~'
helper_line = 'bun ' + ${JSON.stringify(HELPER)} + " register 'http://127.0.0.1:1'; " + ${JSON.stringify(checkTty)} + '\\n'

# Case 1: unbracketed 6-line paste (attempt 1), bracketed 6-line paste (attempt 2), then valid code (attempt 3).
assert read_until(b'READY_SHELL> ', 1), buf
os.write(master, helper_line.encode())
assert read_until(b'Paste only the one-time code', 1), buf
os.write(master, cmd.encode())
assert read_until(b'Paste only the one-time code', 2), buf
os.write(master, bracketed.encode())
assert read_until(b'Paste only the one-time code', 3), buf
os.write(master, (${JSON.stringify(fakeCode)} + '\\n').encode())
assert read_until(b'Registration was refused.', 1), buf
assert read_until(b'POST_TTY True True', 1), buf
assert read_until(b'READY_SHELL> ', 2), buf
os.write(master, b'echo AFTER_RETRY_OK\\n')
assert read_until(b'AFTER_RETRY_OK', 2), buf
assert read_until(b'READY_SHELL> ', 3), buf

# Case 2: three consecutive raw 6-line pastes exhaust retries and still leave zero lines in bash.
os.write(master, helper_line.encode())
assert read_until(b'Paste only the one-time code', 4), buf
os.write(master, cmd.encode())
assert read_until(b'Paste only the one-time code', 5), buf
os.write(master, cmd.encode())
assert read_until(b'Paste only the one-time code', 6), buf
os.write(master, cmd.encode())
assert read_until(${JSON.stringify(NO_CODE_MESSAGE)}.encode(), 1), buf
assert read_until(b'POST_TTY True True', 2), buf
assert read_until(b'READY_SHELL> ', 4), buf
os.write(master, b'echo AFTER_REFUSAL_OK\\n')
assert read_until(b'AFTER_REFUSAL_OK', 2), buf
assert read_until(b'READY_SHELL> ', 5), buf

os.write(master, b'exit\\n')
p.wait(timeout=5)
os.close(master)
print('OUT=' + buf.decode('utf-8', 'replace'))
`
    const { stdout, stderr, exitCode } = await runPython(script)
    expect(exitCode, stderr).toBe(0)
    expect(stdout).toContain(INVALID_CODE_MESSAGE)
    expect(stdout).toContain(NO_CODE_MESSAGE)
    expect(stdout).toContain('POST_TTY True True')
    expect(stdout).toContain('AFTER_RETRY_OK')
    expect(stdout).toContain('AFTER_REFUSAL_OK')
    // Neither the pasted 6-line command nor the secret code ever echoed or reached bash.
    for (const leaked of ['umask 077', 'curl -fsSL', 'sha256sum', 'tar -xzf', 'bot.tailnet.example', 'connect.lilbot.example', fakeCode]) expect(stdout).not.toContain(leaked)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 25_000)
