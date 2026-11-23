import { expect, test } from 'bun:test'
import { engineName, formatEngineWithVersion, hasCodingWorkers, partitionEngines, workerRowSummary } from '../../web/src/computers/coding-engines'
import { buildOutsideCommand, buildPrivateCommand } from '../../web/src/computers/command-line-script'
import { commandLinePhaseOf } from '../../web/src/computers/use-command-line'

const HASH = '0123456789abcdef'.repeat(4)
const LINUX = { fileName: 'lilbot-helper-linux-x64.tar.gz', sha256: HASH, os: 'linux' as const }
const MACOS = { fileName: 'lilbot-helper-macos-arm64.tar.gz', sha256: HASH, os: 'macos' as const }

test('buildPrivateCommand builds a verified, zero-secret subshell command for Linux and macOS', () => {
  const linux = buildPrivateCommand({ privateOrigin: 'https://bot.tailnet.example:8443', download: LINUX, helperUrl: 'https://connect.lilbot.example' })!
  expect(linux).toContain('umask 077')
  expect(linux).toContain(`trap 'rm -rf "$d"' EXIT INT TERM`)
  expect(linux).toContain("--proto '=https' --max-redirs 0 'https://bot.tailnet.example:8443/api/computers/download/lilbot-helper-linux-x64.tar.gz'")
  expect(linux).toContain(`printf '%s  %s\\n' '${HASH}' "$d/h.tar.gz" | sha256sum -c - >/dev/null`)
  expect(linux).toContain('tar -xzf "$d/h.tar.gz" -C "$d" lilbot-helper lilbot-helper.sha256')
  expect(linux).toContain(`"$d/lilbot-helper" install 'https://connect.lilbot.example'`)
  expect(linux).not.toContain('curl -k')
  expect(linux).not.toMatch(/\|\s*(ba|z)?sh\b/)
  expect(linux).not.toContain('xattr')

  const mac = buildPrivateCommand({ privateOrigin: 'https://bot.tailnet.example:8443', download: MACOS, helperUrl: 'https://connect.lilbot.example' })!
  expect(mac).toContain(`printf '%s  %s\\n' '${HASH}' "$d/h.tar.gz" | shasum -a 256 -c - >/dev/null`)
  expect(mac).toContain('lilbot-helper-macos-arm64.tar.gz')
  expect(mac).not.toContain('sha256sum')
})

test('buildOutsideCommand verifies the local file before unpacking and clears macOS quarantine only after checksum', () => {
  const linux = buildOutsideCommand({ download: LINUX, helperUrl: 'https://connect.lilbot.example' })!
  expect(linux).toContain('f="$HOME/lilbot-helper-linux-x64.tar.gz"')
  expect(linux).toContain(`printf '%s  %s\\n' '${HASH}' "$f" | sha256sum -c - >/dev/null`)
  expect(linux).toContain(`"$d/lilbot-helper" install 'https://connect.lilbot.example'`)
  expect(linux).not.toContain('curl')
  expect(linux).not.toContain('xattr')

  const mac = buildOutsideCommand({ download: MACOS, helperUrl: 'https://connect.lilbot.example' })!
  expect(mac).toContain('shasum -a 256 -c - >/dev/null')
  expect(mac).toContain(`"$d/lilbot-helper" install 'https://connect.lilbot.example'`)
  expect(mac.indexOf('shasum -a 256')).toBeLessThan(mac.indexOf('tar -xzf'))
  expect(mac.indexOf('tar -xzf')).toBeLessThan(mac.indexOf('xattr -d com.apple.quarantine'))
})

test('command builders refuse shell metacharacters, bad hashes, non-tar archives and non-HTTPS remote origins', () => {
  expect(buildPrivateCommand({ privateOrigin: 'http://bot.tailnet.example:8443', download: LINUX, helperUrl: 'https://connect.lilbot.example' })).toBeNull()
  expect(buildPrivateCommand({ privateOrigin: "https://bot.example';rm -rf /", download: LINUX, helperUrl: 'https://connect.lilbot.example' })).toBeNull()
  // Bun's URL parser accepts quotes, $, backticks, and ; in hostnames — SAFE_ORIGIN must still reject them.
  for (const sneaky of ["https://a'b.example", 'https://a$b.example', 'https://a;b.example', 'https://a`b.example']) {
    expect(new URL(sneaky).origin).toBe(sneaky)
    expect(buildPrivateCommand({ privateOrigin: sneaky, download: LINUX, helperUrl: 'https://connect.lilbot.example' })).toBeNull()
    expect(buildPrivateCommand({ privateOrigin: 'https://bot.example', download: LINUX, helperUrl: sneaky })).toBeNull()
    expect(buildOutsideCommand({ download: LINUX, helperUrl: sneaky })).toBeNull()
  }
  expect(buildPrivateCommand({ privateOrigin: 'https://bot.example', download: { ...LINUX, fileName: '../evil.tar.gz' }, helperUrl: 'https://connect.lilbot.example' })).toBeNull()
  expect(buildPrivateCommand({ privateOrigin: 'https://bot.example', download: { ...LINUX, fileName: 'app.zip' }, helperUrl: 'https://connect.lilbot.example' })).toBeNull()
  expect(buildPrivateCommand({ privateOrigin: 'https://bot.example', download: { ...LINUX, sha256: 'not-a-hash' }, helperUrl: 'https://connect.lilbot.example' })).toBeNull()
  expect(buildOutsideCommand({ download: LINUX, helperUrl: 'https://connect.lilbot.example/extra' })).toBeNull()
  // Loopback HTTP is allowed for isolated local development checks only.
  expect(buildPrivateCommand({ privateOrigin: 'http://127.0.0.1:41234', download: LINUX, helperUrl: 'http://127.0.0.1:41235' })).toContain("--proto '=http'")
})

test('commandLinePhaseOf tracks setup, waiting, registered, connected and expired states', () => {
  const attempt = { attemptId: 'id', expiresAt: 10_000 }
  expect(commandLinePhaseOf(null, null, 1_000)).toBe('setup')
  expect(commandLinePhaseOf(attempt, null, 1_000)).toBe('waiting')
  expect(commandLinePhaseOf(attempt, { state: 'waiting' }, 9_999)).toBe('waiting')
  expect(commandLinePhaseOf(attempt, { state: 'waiting' }, 10_000)).toBe('expired')
  expect(commandLinePhaseOf(attempt, { state: 'registered' }, 12_000)).toBe('registered')
  expect(commandLinePhaseOf(attempt, { state: 'connected' }, 12_000)).toBe('connected')
})

test('coding-engines handles legacy entries, multiple engines, unsupported engines and signedIn cleanly', () => {
  expect(engineName('claude-code')).toBe('Claude Code')
  expect(engineName('hermes')).toBe('Hermes')
  expect(engineName('codex')).toBe('Codex')
  expect(engineName('opencode-acp')).toBe('Opencode Acp')
  // Older helper omits `supported`: counts as supported.
  const legacy = { capabilities: ['exec', 'worker'] as ('exec' | 'worker')[], workerAgents: [{ driver: 'claude-code' as const, version: '2.1.327' }] }
  expect(hasCodingWorkers(legacy)).toBe(true)
  expect(workerRowSummary(legacy)).toEqual({ ready: true, text: 'Coding workers (Claude Code)' })

  // Mixed supported + unsupported engines (LILA-36 shape).
  const mixed = {
    capabilities: ['exec', 'worker'] as ('exec' | 'worker')[],
    workerAgents: [
      { driver: 'claude-code', version: '2.1.327', supported: true, signedIn: true },
      { driver: 'hermes', version: '0.9.1', supported: false },
      { driver: 'codex', version: '0.4.0', supported: false }
    ] as never
  }
  expect(hasCodingWorkers(mixed)).toBe(true)
  expect(partitionEngines(mixed).supported.map(formatEngineWithVersion)).toEqual(['Claude Code 2.1.327'])
  expect(partitionEngines(mixed).unsupported.map(formatEngineWithVersion)).toEqual(['Hermes 0.9.1', 'Codex 0.4.0'])
  expect(workerRowSummary(mixed)).toEqual({ ready: true, text: 'Coding workers (Claude Code)' })

  // Only unsupported engines: NOT ready for coding workers, reports them clearly.
  const onlyUnsupported = {
    capabilities: ['exec'] as ('exec' | 'worker')[],
    workerAgents: [
      { driver: 'hermes', version: '0.9.1', supported: false },
      { driver: 'codex', version: '0.4.0', supported: false }
    ] as never
  }
  expect(hasCodingWorkers(onlyUnsupported)).toBe(false)
  expect(workerRowSummary(onlyUnsupported)).toEqual({ ready: false, text: 'Hermes, Codex found, not supported yet' })
  expect(workerRowSummary({ capabilities: ['exec'] })).toEqual({ ready: false, text: 'No coding engine' })
})
