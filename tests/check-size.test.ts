import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENTS_LIMIT, checkAgentsDoc } from '../scripts/check-size'

function withTempRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-agents-check-'))
  try {
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('repo AGENTS.md stays within line/byte limits and has valid docs links', () => {
  expect(checkAgentsDoc(join(import.meta.dir, '..'))).toEqual([])
})

test('flags AGENTS.md over line or byte limit', () => {
  withTempRoot(root => {
    writeFileSync(join(root, 'AGENTS.md'), 'line\n'.repeat(11))
    const problems = checkAgentsDoc(root, { maxLines: 10, maxBytes: 40 })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('over the 10-line limit')
    expect(problems[1]).toContain('over the 40-byte')
  })
})

test('flags broken docs/ links in AGENTS.md and accepts valid links with anchors', () => {
  withTempRoot(root => {
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs/ok.md'), '# ok\n')
    writeFileSync(join(root, 'AGENTS.md'), '[ok](docs/ok.md#sec) and [missing](docs/missing.md)\n')
    const problems = checkAgentsDoc(root, AGENTS_LIMIT)
    expect(problems).toEqual(['AGENTS.md: broken link to docs/missing.md (file does not exist).'])
  })
})
