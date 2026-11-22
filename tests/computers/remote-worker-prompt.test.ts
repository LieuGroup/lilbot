import { expect, test } from 'bun:test'
import { assembleRemoteWorkerPrompt } from '../../server/computers/remote-worker-prompt'
import { validateRemoteCwd, validateRemoteModel } from '../../server/computers/remote-worker-sanitize'
import { WORKER_SYSTEM_PROMPT_MAX_BYTES } from '../../shared/worker-frame-schema'

test('assembleRemoteWorkerPrompt fits all sections within 96 KiB, trims optional parts, and fails plainly if base instructions cannot fit', () => {
  const ok = assembleRemoteWorkerPrompt({
    instructionsWithNote: 'Be concise.\n<lilbot-system-note>note</lilbot-system-note>',
    computerName: 'Workstation',
    cwd: '~/code/app',
    memoryBlock: 'Lasting facts:\n- [abcd1234] Prefers SwiftUI.',
    skills: [{ name: 'lilbot-coding', description: 'Coding workflow.' }],
    codingSkillBody: '# Coding\nUse git worktrees.'
  })
  expect(ok.ok).toBe(true)
  if (ok.ok) {
    expect(ok.bytes).toBeLessThanOrEqual(WORKER_SYSTEM_PROMPT_MAX_BYTES)
    expect(ok.systemPrompt).toContain('<lilbot-remote-worker>')
    expect(ok.systemPrompt).toContain('<lilbot-coding-skill>')
    expect(ok.systemPrompt).toContain('<recalled-memory>')
    expect(ok.systemPrompt).toContain('<lilbot-skills>')
  }

  const tight = assembleRemoteWorkerPrompt({
    instructionsWithNote: 'Core instructions.',
    computerName: 'Box',
    cwd: '/tmp/repo',
    memoryBlock: Array.from({ length: 120 }, (_, i) => `- [id${i}] Fact number ${i} ${'x'.repeat(60)}`).join('\n'),
    skills: Array.from({ length: 40 }, (_, i) => ({ name: `skill-${i}`, description: 'd'.repeat(80) })),
    codingSkillBody: 'c'.repeat(5000),
    maxBytes: 1500
  })
  expect(tight.ok).toBe(true)
  if (tight.ok) expect(Buffer.byteLength(tight.systemPrompt, 'utf8')).toBeLessThanOrEqual(1500)

  const tooBig = assembleRemoteWorkerPrompt({
    instructionsWithNote: 'a'.repeat(WORKER_SYSTEM_PROMPT_MAX_BYTES + 500),
    computerName: 'Box',
    cwd: '/tmp/repo',
    memoryBlock: '',
    skills: []
  })
  expect(tooBig.ok).toBe(false)
})

test('validateRemoteCwd and validateRemoteModel enforce paths and agent compatibility', () => {
  expect(validateRemoteCwd('/abs/path').ok).toBe(true)
  expect(validateRemoteCwd('~/code/repo').ok).toBe(true)
  expect(validateRemoteCwd('~').ok).toBe(true)
  expect(validateRemoteCwd('relative/path').ok).toBe(false)
  expect(validateRemoteCwd('~other/repo').ok).toBe(false)
  expect(validateRemoteCwd('/bad\npath').ok).toBe(false)
  expect(validateRemoteCwd('/bad\u202epath').ok).toBe(false)

  const claude = [{ driver: 'claude-code' as const, version: '2.1.0' }]
  expect(validateRemoteModel({ provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }, claude)).toEqual({
    ok: true,
    driver: 'claude-code',
    wireModel: 'claude-sonnet-5-5'
  })
  expect(validateRemoteModel({ provider: 'anthropic', model: 'opus' }, claude)).toEqual({ ok: true, driver: 'claude-code', wireModel: 'opus' })
  expect(validateRemoteModel({ provider: 'cliproxyapi', model: 'deepseek/deepseek-v4.1' }, claude).ok).toBe(false)
  expect(validateRemoteModel({ provider: 'google', model: 'gemini-4-neon' }, claude).ok).toBe(false)
  expect(validateRemoteModel({ provider: 'anthropic', model: '--bad-flag' }, claude).ok).toBe(false)
  expect(validateRemoteModel(null, claude).ok).toBe(false)
  expect(validateRemoteModel({ provider: 'anthropic', model: 'claude-sonnet-5-5' }, []).ok).toBe(false)
})
