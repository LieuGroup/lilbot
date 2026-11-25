import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BOT_DETAILS_TABS, normalizeBotDetailsTab } from '../../ios/src/bots/details-tabs'
import { countLine, groupLibraryItems, libraryRowMeta, pathParts, viewOf } from '../../ios/src/library/library-lines'
import { createdRoutineText, duration, routineLine, runLine, scheduleLabel } from '../../ios/src/routines/routine-lines'
import { ago, createdWebhookText, deleteWebhookText, webhookLine } from '../../ios/src/webhooks/webhook-lines'
import { formatElapsed } from '../../shared/client/activity/activity-since'
import { fileOrder, matchesSkill, skillCount, writtenBy } from '../../shared/client/skills/skill-lines'
import type { LibraryItem } from '../../shared/library-schema'
import type { Routine } from '../../shared/routine-schema'
import type { Skill } from '../../shared/skills-schema'
import type { Webhook } from '../../shared/webhook-schema'

describe('iOS Bot Details 3-tab shell (no Memory tab) and feature rules', () => {
  test('Bot Details exposes strictly Activity, Library, and Setup — never Memory', () => {
    expect(BOT_DETAILS_TABS.map(t => t.id)).toEqual(['activity', 'library', 'setup'])
    expect(BOT_DETAILS_TABS.map(t => t.label)).toEqual(['Activity', 'Library', 'Setup'])
    expect(normalizeBotDetailsTab('activity')).toBe('activity')
    expect(normalizeBotDetailsTab('library')).toBe('library')
    expect(normalizeBotDetailsTab('setup')).toBe('setup')
    expect(normalizeBotDetailsTab('memory')).toBe('activity')
    expect(normalizeBotDetailsTab(undefined)).toBe('activity')

    const screenSrc = readFileSync(resolve(process.cwd(), 'ios/src/bots/details-screen.tsx'), 'utf8')
    expect(screenSrc).not.toContain('MemoryTab')
    expect(screenSrc).not.toContain("'memory'")
    expect(screenSrc).toContain('evaluateTabSwipe')
    expect(screenSrc).toContain('GestureDetector')
  })

  test('Activity elapsed formatting and Routine line rules match web copy', () => {
    const now = new Date(2026, 10, 25, 14, 0, 0).getTime()
    expect(formatElapsed(20_000)).toBe('just now')
    expect(formatElapsed(5 * 60_000)).toBe('5 min')
    expect(formatElapsed(2 * 3_600_000)).toBe('2 h')

    const routine: Routine = {
      id: 'r1',
      botId: 'b1',
      description: 'Check reviews every morning',
      schedule: { kind: 'daily', time: '09:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      scheduleText: 'Every day at 09:00',
      createdBy: 'oscar',
      paused: false,
      lastRunAt: null,
      nextRunAt: now + 3_600_000,
      runs: []
    }
    expect(scheduleLabel(routine.schedule)).toBe('Every day at 09:00')
    expect(routineLine(routine, now).tone).toBe('plain')
    expect(routineLine({ ...routine, paused: true }, now).tone).toBe('paused')
    expect(
      routineLine(
        { ...routine, runs: [{ id: 'run1', routineId: 'r1', botId: 'b1', dueAt: now, startedAt: now, finishedAt: null, chatId: null, status: 'running', result: '' }] },
        now
      ).tone
    ).toBe('running')
    expect(runLine({ status: 'failed', result: 'Timed out' })).toBe('Failed: Timed out')
    expect(duration(90_000)).toBe('2 min')
    expect(createdRoutineText(routine, undefined)).toBe('You asked for it')
  })

  test('Webhook rules format state cleanly and never draw the secret address on screen', () => {
    const now = new Date(2026, 10, 25, 14, 0, 0).getTime()
    const webhook: Webhook = {
      id: 'w1',
      botId: 'b1',
      description: 'Triage new GitHub issues',
      source: 'GitHub',
      createdBy: 'bot',
      signing: 'github',
      paused: false,
      capabilities: [],
      createdAt: now - 86_400_000,
      lastEventAt: now - 10 * 60_000,
      runs: []
    }
    expect(ago(now - 10 * 60_000, now)).toBe('10 min ago')
    expect(webhookLine(webhook, now)).toEqual({ text: 'GitHub · last event 10 min ago', tone: 'plain' })
    expect(webhookLine({ ...webhook, paused: true }, now).tone).toBe('paused')
    expect(createdWebhookText(webhook, 'Scout')).toBe('Scout made it')
    expect(deleteWebhookText(webhook)).toContain('GitHub')

    const detailSrc = readFileSync(resolve(process.cwd(), 'ios/src/webhooks/webhook-detail-sheet.tsx'), 'utf8')
    const hookSrc = readFileSync(resolve(process.cwd(), 'ios/src/webhooks/use-webhooks.ts'), 'utf8')
    expect(hookSrc).toContain("'webhooks.address'")
    expect(detailSrc).toContain('onCopyAddress')
  })

  test('Library grouping, view detection, and read-only workspace path helpers work accurately', () => {
    const now = new Date(2026, 10, 25, 14, 0, 0).getTime() // Wed Nov 25 2026
    const items: LibraryItem[] = [
      {
        id: '1',
        botId: 'b1',
        title: 'Chart',
        path: 'charts/q4.png',
        kind: 'media',
        size: 2048,
        createdAt: now - 3_600_000,
        chatId: 'c1',
        routineRunId: null,
        missing: false,
        mime: 'image/png',
        url: '/library/1'
      },
      {
        id: '2',
        botId: 'b1',
        title: 'Notes',
        path: 'notes.md',
        kind: 'page',
        size: 512,
        createdAt: now - 20 * 86_400_000,
        chatId: 'c1',
        routineRunId: null,
        missing: false,
        mime: 'text/markdown',
        url: '/library/2'
      }
    ]
    const groups = groupLibraryItems(items, now)
    expect(groups.map(g => g.label)).toEqual(['Today', 'Older'])
    expect(libraryRowMeta(items[0], now)).toContain('2.0 KB')
    expect(viewOf(items[0])).toBe('image')
    expect(viewOf(items[1])).toBe('markdown')
    expect(pathParts('reports/2026')).toEqual([
      { name: 'Workspace', path: '' },
      { name: 'reports', path: 'reports' },
      { name: '2026', path: 'reports/2026' }
    ])
    expect(
      countLine([
        { name: 'docs', directory: true, size: 0 },
        { name: 'a.txt', directory: false, size: 10 }
      ])
    ).toContain('1 folder, 1 file')
  })

  test('shared Skills helpers filter, count, attribute, and order files', () => {
    const skills: Skill[] = [
      { name: 'research-brief', description: 'Summarise sources with links', author: 'oscar', updatedAt: 1000, enabled: true, origin: { kind: 'oscar' }, excluded: false },
      { name: 'code-review', description: 'Check diffs carefully', author: 'lilbot', updatedAt: 1000, enabled: false, origin: { kind: 'lilbot' }, excluded: false }
    ]
    expect(matchesSkill(skills[0], 'links')).toBe(true)
    expect(matchesSkill(skills[1], 'links')).toBe(false)
    expect(skillCount(skills, 2, false)).toBe('2 · 1 off')
    expect(skillCount(skills, 1, true)).toBe('1 of 2')
    expect(writtenBy({ kind: 'oscar' }, () => undefined)).toBe('You')
    expect(writtenBy({ kind: 'lilbot' }, () => undefined)).toBe('LilBot')
    expect(fileOrder(['notes.md', 'SKILL.md', 'a.txt'])).toEqual(['SKILL.md', 'a.txt', 'notes.md'])
  })
})
