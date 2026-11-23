import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { botCapability } from '../../server/bots/bot-capability'
import { checkCommandSafety } from '../../server/computers/command-safety'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { loadServerKey } from '../../server/computers/server-key'
import { openDatabase } from '../../server/database/database'
import { createEngineApi } from '../../server/http/engine-api'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'

const HOME = '/Users/alice'

const BLOCKED: [string, string][] = [
  ['rm -rf /', 'root filesystem'],
  ['rm -rf //', 'root filesystem'],
  ['rm -rf /./..', 'root filesystem'],
  ['rm -rf /*', 'root filesystem'],
  ['rm -rf / *', 'root filesystem'],
  ['rm -rf "/"', 'root filesystem'],
  ['rm -rf -- /', 'root filesystem'],
  ['rm -rf /tmp/ok /', 'root filesystem'],
  ['rm -rf /tmp/..', 'root filesystem'],
  ['rm -rf /etc', 'system directory'],
  ['rm -rf /etc/*', 'system directory'],
  ['rm -rf /home', 'system directory'],
  ['rm -rf /home/*', 'system directory'],
  ['rm -rf /usr', 'system directory'],
  ['rm -rf /var/*', 'system directory'],
  ['rm -rf /Users', 'system directory'],
  ['rm -rf /System/*', 'system directory'],
  ['rm -rf ~', 'home directory'],
  ['rm -rf ~/', 'home directory'],
  ['rm -rf ~/*', 'home directory'],
  ['rm -rf ~/sub/..', 'home directory'],
  ['rm -rf $HOME', 'home directory'],
  [`rm -rf "\${HOME}"`, 'home directory'],
  ['rm -rf "$HOME/*"', 'home directory'],
  ['rm -rf ~root', 'home directory'],
  ['rm -rf /Users/alice', 'home directory'],
  ['rm -rf /Users/alice/*', 'home directory'],
  ['rm -rf /Users/alice/.', 'home directory'],
  ['mkfs /dev/sdb', 'mkfs'],
  ['mkfs.ext4 /dev/sda1', 'mkfs'],
  ['newfs_apfs /dev/disk2', 'newfs'],
  ['diskutil eraseDisk APFS Test disk2', 'diskutil'],
  ['diskutil apfs deleteContainer disk2', 'diskutil'],
  ['dd if=/dev/zero of=/dev/sda bs=1M', 'dd to raw block device'],
  ['dd if=/dev/zero of="/dev/nvme0n1"', 'dd to raw block device'],
  ['dd if=/dev/zero of=/dev/rdisk2', 'dd to raw block device'],
  ['cat f > /dev/sda', 'redirect to raw block device'],
  ['echo x >> /dev/disk0', 'redirect to raw block device'],
  ['cat f > "/dev/nvme0n1"', 'redirect to raw block device'],
  ['echo x | tee /dev/sda', 'write to raw block device'],
  [':(){ :|:& };:', 'fork bomb'],
  ['bomb(){ bomb|bomb& };bomb', 'fork bomb'],
  ['kill -1', 'kill all processes'],
  ['kill -9 -1', 'kill all processes'],
  ['kill -s KILL -1', 'kill all processes'],
  ['kill -- -1', 'kill all processes'],
  ['shutdown -h now', 'shutdown/reboot'],
  ['reboot', 'shutdown/reboot'],
  ['halt', 'shutdown/reboot'],
  ['poweroff', 'shutdown/reboot'],
  ['init 0', 'init 0/6'],
  ['telinit 6', 'telinit 0/6'],
  ['systemctl reboot', 'systemctl'],
  ['systemctl --force poweroff', 'systemctl'],
  ['systemctl -H host halt', 'systemctl'],
  ['r\\m -rf /', 'root filesystem'],
  ['r""m -rf /', 'root filesystem'],
  ["r''m -rf /", 'root filesystem'],
  ["$'\\x72m' -rf /", 'root filesystem'],
  [`rm\${IFS}-rf\${IFS}/`, 'root filesystem'],
  ['rm -rf \\\n/', 'root filesystem'],
  ['\x1b[31mrm\x1b[0m -rf /', 'root filesystem'],
  ['\u200brm -rf /', 'root filesystem'],
  ['ｒｍ -rf /', 'root filesystem'],
  ['/bin/rm -rf /', 'root filesystem'],
  ['/sbin/mkfs.ext4 /dev/sda1', 'mkfs'],
  ['sudo -u root rm -rf /', 'root filesystem'],
  ['env VAR=1 reboot', 'shutdown/reboot'],
  ['env -S "rm -rf /"', 'root filesystem'],
  ['timeout 30 shutdown -r now', 'shutdown/reboot'],
  ['nice -n 5 poweroff', 'shutdown/reboot'],
  ['nohup mkfs /dev/sdb', 'mkfs'],
  ['command rm -rf /', 'root filesystem'],
  ['echo x | xargs mkfs', 'mkfs'],
  ['if false; then mkfs; fi', 'mkfs'],
  ['(rm -rf /)', 'root filesystem'],
  ['{ reboot; }', 'shutdown/reboot'],
  ['echo "$(reboot)"', 'shutdown/reboot'],
  ['echo "`rm -rf /`"', 'root filesystem'],
  ['cat "f\\"n.txt"; rm -rf /', 'root filesystem'],
  ['sh -c "rm -rf /"', 'root filesystem'],
  ["bash -lc 'cat f > /dev/sda'", 'redirect to raw block device'],
  ["bash -c ':(){ :|:& };:'", 'fork bomb'],
  ['eval "rm -rf /"', 'root filesystem'],
  ['zsh -c "bash -c \'reboot\'"', 'shutdown/reboot']
]

const ALLOWED = [
  'printf OK',
  'rm -rf /tmp/scratch-123',
  'rm -rf ~/project/dist',
  'rm -rf /Users/alice/project/dist',
  'rm -f /etc/my-test-config',
  'cd /tmp/work && rm -rf *',
  'echo "rm -rf /"',
  'git commit -m "fix: block rm -rf / and mkfs and shutdown"',
  'echo "cat f > /dev/sda"',
  'echo ":(){ :|:& };:"',
  'echo "line1\nreboot"',
  "echo '$(reboot)'",
  'echo "\\$(reboot)"',
  'grep -o "[^\\"]*" file.txt',
  'sed -n "$(grep -n X f | cut -d: -f1),+3p" f',
  'command -v reboot',
  'kill -9 12345',
  'systemctl status lilbot',
  'systemctl help reboot',
  'dd if=/dev/zero of=/tmp/test.img bs=1M count=1',
  'diskutil list'
]

test('blocks destructive commands and evasions', () => {
  for (const [cmd, expected] of BLOCKED) {
    const reason = checkCommandSafety(cmd, HOME)
    expect(reason, `expected blocked: ${cmd}`).not.toBeNull()
    expect(reason!, cmd).toContain(expected)
  }
})

test('allows benign commands and quoted prose', () => {
  for (const cmd of ALLOWED) {
    expect(checkCommandSafety(cmd, HOME), `expected allowed: ${cmd}`).toBeNull()
  }
})

test('fails closed on parser and nesting limits', () => {
  expect(checkCommandSafety('a'.repeat(5000), HOME)).toContain('parser limit')
  expect(checkCommandSafety(';'.repeat(25_000), HOME)).toContain('parser limit')
  let nested = 'echo ok'
  for (let i = 0; i < 10; i++) nested = `sh -c ${JSON.stringify(nested)}`
  expect(checkCommandSafety(nested, HOME)).toContain('nesting limit')
})

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
})

test('ComputerService.submit and /engine/computers/submit enforce the safety stop before queueing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cmd-safety-'))
  const db = openDatabase(':memory:')
  const store = new ComputerStore(db)
  const service = new ComputerService(
    store,
    loadServerKey(root),
    id => id === 'bot-1',
    () => root,
    () => {},
    () => 'full-access'
  )
  cleanups.push(() => {
    service.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  store.add('remote', { name: 'Remote', os: 'darwin', home: '/Users/remote', capabilities: ['exec'] }, 'key')
  await expect(service.submit('bot-1', { computer: 'remote', requestId: 'r1', background: true, operation: { kind: 'exec', command: 'rm -rf /Users/remote' } })).rejects.toThrow(
    'safety stop'
  )
  expect(store.pending('remote')).toHaveLength(0)
  expect((await service.submit('bot-1', { computer: 'remote', requestId: 'r2', background: true, operation: { kind: 'exec', command: 'rm -rf /Users/remote/tmp' } })).status).toBe(
    'pending'
  )

  const token = 'test-token'
  const api = createEngineApi(new MemoryService(new MemoryStore(db)), token, 3370, {
    botExists: id => id === 'bot-1',
    bots: { listBots: async () => [{ id: 'bot-1' }] } as any,
    computers: service
  })
  const res = await api(
    new Request('http://127.0.0.1:3370/engine/computers/submit', {
      method: 'POST',
      headers: { host: '127.0.0.1:3370', authorization: `Bearer ${token}`, 'x-lilbot-bot-capability': botCapability(token, 'bot-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ computer: 'leader', requestId: 'r3', background: false, operation: { kind: 'exec', command: 'if false; then mkfs; fi' } })
    }),
    '/engine/computers/submit'
  )
  expect(res.status).toBe(422)
  expect(((await res.json()) as { error: string }).error).toContain('LilBot safety stop')
  expect(store.pending('leader')).toHaveLength(0)
})
