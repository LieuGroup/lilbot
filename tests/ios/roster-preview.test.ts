import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type BotWithLastMessage, formatLastMessagePreview, formatRosterTime, localDayKey, msUntilNextLocalDay, USER_MESSAGE_PREFIX } from '../../ios/src/bots/roster-preview'
import { rosterRowDisplay, sameRosterBotDisplay } from '../../ios/src/bots/roster-state'
import { testBot as bot } from '../web/test-bot'

// Anchor: Wednesday, Nov 25 2026 14:30:00 UTC (fixed UTC timezone for deterministic assertions).
const NOW = Date.UTC(2026, 10, 25, 14, 30, 0)
const UTC_US = { now: NOW, locale: 'en-US', timeZone: 'UTC' } as const
const UTC_GB = { now: NOW, locale: 'en-GB', timeZone: 'UTC' } as const

function botWithMsg(overrides: Parameters<typeof bot>[1], lastMessage?: BotWithLastMessage['lastMessage']): BotWithLastMessage {
  return { ...bot('b', overrides), ...(lastMessage ? { lastMessage } : {}) }
}

describe('iOS Roster last-message preview and locale-aware timestamps', () => {
  test('second line priority: live status wins while active, else lastMessage (with "You: " prefix), else description', () => {
    const todayAt = Date.UTC(2026, 10, 25, 9, 15, 0)
    // Bot reply on idle bot replaces description.
    const botReply = rosterRowDisplay(botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: '2.2.0 is submitted.', at: todayAt }), UTC_US)
    expect(botReply.inlineText).toBe('2.2.0 is submitted.')
    expect(botReply.inlineTone).toBe('muted')
    expect(botReply.timeText).toMatch(/9:15\s*AM/)
    expect(botReply.accessibilityLabel).toContain('2.2.0 is submitted.')
    expect(botReply.accessibilityLabel).toContain('9:15')

    // Owner's own message gets clear "You: " prefix.
    const userMsg = rosterRowDisplay(botWithMsg({ function: 'Ships builds' }, { from: 'user', text: 'Ship 2.2.0 now?', at: todayAt }), UTC_US)
    expect(userMsg.inlineText).toBe(`${USER_MESSAGE_PREFIX}Ship 2.2.0 now?`)
    expect(userMsg.timeText).toMatch(/9:15\s*AM/)

    // Unread idle bot highlights the last message in foreground tone + bold name.
    const unreadReply = rosterRowDisplay(
      botWithMsg({ function: 'Ships builds', activity: { status: 'idle', text: '', unread: true } }, { from: 'bot', text: 'Ready for review.', at: todayAt }),
      UTC_US
    )
    expect(unreadReply.inlineText).toBe('Ready for review.')
    expect(unreadReply.inlineTone).toBe('foreground')
    expect(unreadReply.boldName).toBe(true)

    // No message yet falls back to bot description, with null timeText (zero gap).
    const noMsg = rosterRowDisplay(botWithMsg({ function: 'Ships builds' }), UTC_US)
    expect(noMsg.inlineText).toBe('Ships builds')
    expect(noMsg.timeText).toBeNull()

    // Empty / whitespace preview text also falls back to bot description.
    expect(formatLastMessagePreview({ from: 'bot', text: '   ', at: todayAt })).toBeNull()
    const blankMsg = rosterRowDisplay(botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: '  ', at: todayAt }), UTC_US)
    expect(blankMsg.inlineText).toBe('Ships builds')

    // Working / workers / waiting / failed / finished / unavailable / group live statuses win over lastMessage.
    const working = rosterRowDisplay(
      botWithMsg({ function: 'Ships builds', activity: { status: 'working', text: 'Running tests', unread: false } }, { from: 'bot', text: 'Old reply', at: todayAt }),
      UTC_US
    )
    expect(working.inlineText).toBe('Running tests')
    expect(working.statusMark).toBe('working')
    expect(working.timeText).toMatch(/9:15\s*AM/)

    const withWorker = rosterRowDisplay(
      { ...botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: 'Old reply', at: todayAt }), workers: { count: 1, activity: 'Building app' } },
      UTC_US
    )
    expect(withWorker.inlineText).toBe('1 worker · Building app')

    const waiting = rosterRowDisplay(
      botWithMsg({ function: 'Ships builds', activity: { status: 'waiting', text: '', unread: true } }, { from: 'bot', text: 'Old reply', at: todayAt }),
      UTC_US
    )
    expect(waiting.inlineText).toBe('Waiting for you')

    const failed = rosterRowDisplay(
      botWithMsg({ function: 'Ships builds', activity: { status: 'failed', text: '', unread: false } }, { from: 'bot', text: 'Old reply', at: todayAt }),
      UTC_US
    )
    expect(failed.inlineText).toBe('Failed')
    expect(failed.inlineTone).toBe('destructive')

    const unavailable = rosterRowDisplay(botWithMsg({ function: 'Ships builds', runnable: false }, { from: 'bot', text: 'Old reply', at: todayAt }), UTC_US)
    expect(unavailable.inlineText).toBe('Runtime unavailable')

    const inGroup = rosterRowDisplay(
      {
        ...botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: 'Old reply', at: todayAt }),
        groups: [{ id: 'g1', purpose: 'Release', round: 1, roundCap: 6, leading: true }]
      },
      UTC_US
    )
    expect(inGroup.inlineText).toBe('Leading a group')
  })

  test('formatRosterTime formats today as time, 1..6 days ago as weekday, 7+ days ago as date, in device locale', () => {
    const todayMorning = Date.UTC(2026, 10, 25, 9, 5, 0)
    expect(formatRosterTime(todayMorning, UTC_US)).toMatch(/9:05\s*AM/)
    expect(formatRosterTime(todayMorning, UTC_GB)).toBe('09:05')

    // 1 day ago (Tuesday) through 6 days ago (Thursday) -> localized short weekday.
    expect(formatRosterTime(Date.UTC(2026, 10, 24, 23, 50, 0), UTC_US)).toBe('Tue')
    expect(formatRosterTime(Date.UTC(2026, 10, 19, 10, 0, 0), UTC_US)).toBe('Thu')

    // Exactly 7 days ago in same year -> short month + day.
    expect(formatRosterTime(Date.UTC(2026, 10, 18, 10, 0, 0), UTC_US)).toBe('Nov 18')
    expect(formatRosterTime(Date.UTC(2026, 10, 18, 10, 0, 0), UTC_GB)).toBe('18 Nov')

    // Earlier calendar year -> short locale date with year.
    const priorYear = Date.UTC(2025, 11, 20, 15, 0, 0)
    expect(formatRosterTime(priorYear, UTC_US)).toMatch(/12\/20\/25/)
    expect(formatRosterTime(priorYear, UTC_GB)).toMatch(/20\/12\/2025|20\/12\/25/)

    // Slight forward clock skew within 24h stays a time; invalid timestamps return null.
    expect(formatRosterTime(NOW + 60_000, UTC_US)).toMatch(/2:31\s*PM/)
    expect(formatRosterTime(0, UTC_US)).toBeNull()
    expect(formatRosterTime(-10, UTC_US)).toBeNull()
    expect(formatRosterTime(Number.NaN, UTC_US)).toBeNull()

    // DST transition boundary (America/New_York spring forward on 2026-03-08: 23-hour day).
    const dstNow = Date.UTC(2026, 2, 9, 15, 0, 0) // Mon Mar 9, 11:00 EDT
    const dstYesterday = Date.UTC(2026, 2, 8, 12, 0, 0) // Sun Mar 8, 08:00 EDT
    expect(formatRosterTime(dstYesterday, { now: dstNow, locale: 'en-US', timeZone: 'America/New_York' })).toBe('Sun')
  })

  test('sameRosterBotDisplay invalidates memo on lastMessage changes and Roster wires midnight/foreground refresh', () => {
    const t1 = Date.UTC(2026, 10, 25, 10, 0, 0)
    const t2 = Date.UTC(2026, 10, 25, 10, 5, 0)
    const a = botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: 'First', at: t1 })
    const aClone = botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: 'First', at: t1 })
    const textChanged = botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: 'Second', at: t1 })
    const fromChanged = botWithMsg({ function: 'Ships builds' }, { from: 'user', text: 'First', at: t1 })
    const atChanged = botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: 'First', at: t2 })
    const removed = botWithMsg({ function: 'Ships builds' })

    expect(sameRosterBotDisplay(a, aClone)).toBe(true)
    expect(sameRosterBotDisplay(a, textChanged)).toBe(false)
    expect(sameRosterBotDisplay(a, fromChanged)).toBe(false)
    expect(sameRosterBotDisplay(a, atChanged)).toBe(false)
    expect(sameRosterBotDisplay(a, removed)).toBe(false)

    expect(msUntilNextLocalDay(NOW)).toBeGreaterThanOrEqual(1000)
    expect(localDayKey(NOW)).toMatch(/^\d{4}-\d{1,2}-\d{1,2}$/)

    const rosterSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/roster.tsx'), 'utf8')
    const rowSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/roster-row.tsx'), 'utf8')
    expect(rosterSource).toContain('msUntilNextLocalDay')
    expect(rosterSource).toContain("AppState.addEventListener('change'")
    expect(rosterSource).toContain('now={dayAnchor}')
    expect(rowSource).toContain("alignItems: textLines > 1 ? 'flex-start' : 'center'")
    expect(rowSource).toContain('prev.now === next.now')
  })
})
