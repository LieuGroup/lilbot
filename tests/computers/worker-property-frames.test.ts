import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBoundedLines, resolveClaudeBinary } from '../../helper/worker-claude-env'
import { createClaudeStreamState, parseClaudeLine } from '../../helper/worker-claude-protocol'
import { detectWorkerAgents } from '../../helper/worker-driver'
import { claudeCodeDriver } from '../../helper/worker-driver-claude'
import { WorkerHost } from '../../helper/worker-host'
import { boundWorkerDone, prepareWorkerJournal, unacknowledgedWorkers } from '../../helper/worker-journal'
import { cleanAgentLine, cleanAgentText } from '../../helper/worker-text'
import { HelperFrame } from '../../shared/computer-schema'
import { WORKER_DONE_MAX_BYTES } from '../../shared/worker-frame-schema'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-prop-'))
  roots.push(dir)
  return dir
}

const SECRET = 'Tok3n_AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789'
const SPLITTERS = [
  '\u0000',
  '\u0007',
  '\u0008',
  '\u000b',
  '\u000c',
  '\r',
  '\u001b',
  '\u007f',
  '\u0085',
  '\u009b',
  '\u00ad',
  '\u200b',
  '\u200c',
  '\u200d',
  '\u200e',
  '\u202e',
  '\u2066',
  '\ufeff'
]
const BAD_NUMS: unknown[] = [
  1e25,
  1e308,
  Number.MAX_SAFE_INTEGER + 1,
  Number.MAX_SAFE_INTEGER,
  -1,
  -1e20,
  0,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  '42',
  null,
  {}
]
const splitSecrets = () => [SECRET, ...SPLITTERS.map(ch => `${SECRET.slice(0, 11)}${ch}${SECRET.slice(11, 25)}${ch}${SECRET.slice(25)}`)]

const assertLeaderValid = (frame: unknown, secret?: string) => {
  expect(HelperFrame.safeParse(frame).success).toBe(true)
  const raw = JSON.stringify(frame)
  expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(WORKER_DONE_MAX_BYTES)
  if (secret) expect(raw).not.toContain(secret)
}

test('property (a): every agent-derived field and helper frame validates against leader HelperFrame and never leaks whole or split tokens', async () => {
  for (const candidate of splitSecrets()) {
    const cleanedText = cleanAgentText(`pre ${candidate} post`, 500, SECRET)
    expect(cleanedText).not.toContain(SECRET)
    expect(cleanedText.replace(/[\t\n]/g, '')).not.toMatch(/[\p{Cc}\p{Cf}]/u)
    const cleanedLine = cleanAgentLine(`pre ${candidate} post`, 200, SECRET)
    expect(cleanedLine).not.toContain(SECRET)
    expect(cleanedLine).not.toMatch(/[\p{Cc}\p{Cf}]/u)
  }
  expect(cleanAgentText('x'.repeat(100), 10, SECRET).length).toBeLessThanOrEqual(10)
  expect(cleanAgentLine('x'.repeat(100), 10, SECRET).length).toBeLessThanOrEqual(10)

  const hostileStrings = [...splitSecrets(), '\u0000\u200b\u009b', '--evil-flag', '😀'.repeat(120_000), 'a'.repeat(600_000)]
  for (let i = 0; i < Math.max(hostileStrings.length, BAD_NUMS.length); i++) {
    const s = hostileStrings[i % hostileStrings.length]!
    const n = BAD_NUMS[i % BAD_NUMS.length]
    const state = createClaudeStreamState()
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: s }),
      JSON.stringify({ type: 'assistant', error: s, message: { content: [null, { type: 'text', text: s }, { type: 'tool_use', id: s, name: s, input: { command: s } }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: s, content: s, is_error: true }] } }),
      JSON.stringify({
        type: 'result',
        subtype: i % 2 === 0 ? 'success' : 'error_during_execution',
        is_error: i % 2 === 1,
        session_id: s,
        result: s,
        errors: [s],
        usage: { input_tokens: n, cache_read_input_tokens: n, cache_creation_input_tokens: n, output_tokens: n },
        modelUsage: { m: { contextWindow: n } }
      })
    ]
    for (const line of lines) {
      const ev = parseClaudeLine(line, state, SECRET)
      if (ev) assertLeaderValid({ type: 'worker.event', runId: `run-${i}`, ...ev }, SECRET)
    }
    const done = boundWorkerDone({
      type: 'worker.done',
      runId: `run-${i}`,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      status: state.resultError ? 'failed' : 'completed',
      text: cleanAgentText(state.resultText ?? state.text, 500_000, SECRET),
      items: state.items,
      ...(state.usage ? { usage: state.usage } : {}),
      ...(state.resultError ? { error: state.resultError } : {})
    })
    assertLeaderValid(done, SECRET)
  }

  // Poisoned SQLite worker_runs rows (1e25 usage, corrupt JSON, >1 MiB UTF-8 payload, bad sessionId) are healed on read.
  const dir = tempDir()
  const db = new Database(join(dir, 'requests.db'))
  prepareWorkerJournal(db)
  const poisoned: [string, string][] = [
    ['p-usage', JSON.stringify({ type: 'worker.done', runId: 'p-usage', status: 'completed', text: 'ok', items: [], usage: { inputTokens: 1e25, contextWindow: 1e30 } })],
    ['p-json', '{corrupt'],
    ['p-bytes', JSON.stringify({ type: 'worker.done', runId: 'p-bytes', status: 'completed', text: '😀'.repeat(350_000), items: [] })],
    ['p-sess', JSON.stringify({ type: 'worker.done', runId: 'p-sess', sessionId: '--flag', status: 'completed', text: 'ok', items: [] })]
  ]
  for (const [id, raw] of poisoned) db.query('INSERT INTO worker_runs(run_id, done_frame, finished_at) VALUES(?,?,?)').run(id, raw, Date.now())
  for (const { frame } of unacknowledgedWorkers(db)) assertLeaderValid(frame)
  for (const [id] of poisoned) assertLeaderValid(JSON.parse((db.query('SELECT done_frame FROM worker_runs WHERE run_id=?').get(id) as { done_frame: string }).done_frame))

  // Hostile capabilities + worker.steer.result + worker.mcp.request all validate against HelperFrame.
  const badVer = join(dir, 'bad-ver')
  writeFileSync(badVer, `#!/usr/bin/env bun\nconsole.log('2.1\\u200b327\\u0085\\nsecond-line-ignored')\n`, { mode: 0o700 })
  const agents = await detectWorkerAgents([claudeCodeDriver({ bin: badVer, configDir: dir })])
  expect(agents).toEqual([{ driver: 'claude-code', version: '2.1327', supported: true }])
  assertLeaderValid({ type: 'worker.capabilities', agents })

  const frames: unknown[] = []
  const host = new WorkerHost({ db, configDir: dir, drivers: [], send: (_k, f) => frames.push(f), emitNow: f => Boolean(frames.push(f)) })
  host.handle({ type: 'worker.steer', runId: 'r1', text: 'hi' })
  await Bun.sleep(10)
  for (const f of frames) assertLeaderValid(f)
  db.close()
})

test('property (a) line cap & binary safety: readBoundedLines enforces maxChars across chunk splits; resolveClaudeBinary rejects 0777 and 0644 binaries', async () => {
  const max = 64
  const validA = 'a'.repeat(max)
  const validB = 'd'.repeat(12)
  const bytes = new TextEncoder().encode(`${validA}\n${'b'.repeat(max + 1)}\n${'c'.repeat(max * 5)}\n${validB}\n${'e'.repeat(max + 1)}`)
  for (const chunkSize of [1, 7, 19, 64, 65, 200, bytes.length]) {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let o = 0; o < bytes.length; o += chunkSize) c.enqueue(bytes.subarray(o, o + chunkSize))
        c.close()
      }
    })
    const seen: string[] = []
    await readBoundedLines(stream, [], max, line => seen.push(line))
    expect(seen).toEqual([validA, validB])
    for (const line of seen) expect(line.length).toBeLessThanOrEqual(max)
  }

  const eofSeen: string[] = []
  await readBoundedLines(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('z'.repeat(max)))
        c.close()
      }
    }),
    [],
    max,
    line => eofSeen.push(line)
  )
  expect(eofSeen).toEqual(['z'.repeat(max)])

  const dir = tempDir()
  const safeDir = join(dir, 'safe-bin')
  mkdirSync(safeDir, { mode: 0o755 })
  const bin = join(safeDir, 'claude')
  writeFileSync(bin, '#!/usr/bin/env bun\nconsole.log("1.0")\n')
  chmodSync(bin, 0o777)
  expect(resolveClaudeBinary(undefined, safeDir)).not.toBe(bin)
  chmodSync(bin, 0o644)
  expect(resolveClaudeBinary(undefined, safeDir)).not.toBe(bin)
})
