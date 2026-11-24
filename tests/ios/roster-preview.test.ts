import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createDayRolloverController,
  formatLastMessagePreview,
  formatRosterTime,
  localDayKey,
  MAX_FORWARD_SKEW_MS,
  msUntilNextLocalDay,
  USER_MESSAGE_PREFIX
} from '../../ios/src/bots/roster-preview'
import { rosterRowDisplay, sameRosterBotDisplay } from '../../ios/src/bots/roster-state'
import type { Bot, BotLastMessage } from '../../shared/bot-schema'
import { testBot as bot } from '../web/test-bot'

const NOW = Date.UTC(2026, 10, 25, 14, 30, 0)
const UTC_US = { now: NOW, locale: 'en-US', timeZone: 'UTC' } as const
const UTC_GB = { now: NOW, locale: 'en-GB', timeZone: 'UTC' } as const
const AU_OPT = { now: Date.UTC(2026, 10, 25, 4, 30, 0), locale: 'en-AU', timeZone: 'Australia/Adelaide' } as const

function botWithMsg(overrides: Parameters<typeof bot>[1], lastMessage?: BotLastMessage): Bot {
  return { ...bot('b', overrides), ...(lastMessage ? { lastMessage } : {}) }
}

describe('iOS Roster last-message preview, timestamps, VoiceOver, and midnight rollover', () => {
  test('second line priority, time suppression on live/fallback rows, and VoiceOver wording', () => {
    const todayAt = Date.UTC(2026, 10, 25, 9, 15, 0)
    const sundayAt = Date.UTC(2026, 10, 22, 12, 0, 0)

    const botReply = rosterRowDisplay(botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: '2.2.0 is submitted.', at: todayAt }), UTC_US)
    expect(botReply.inlineText).toBe('2.2.0 is submitted.')
    expect(botReply.inlineTone).toBe('muted')
    expect(botReply.timeText).toMatch(/9:15\s*AM/)
    expect(botReply.accessibilityLabel).toContain('2.2.0 is submitted.')
    expect(botReply.accessibilityLabel).toContain('9:15')

    const userMsg = rosterRowDisplay(botWithMsg({ function: 'Ships builds' }, { from: 'user', text: 'Ship 2.2.0 now?', at: sundayAt }), UTC_US)
    expect(userMsg.inlineText).toBe(`${USER_MESSAGE_PREFIX}Ship 2.2.0 now?`)
    expect(userMsg.timeText).toBe('Sun')
    expect(userMsg.accessibilityLabel).toContain('Sunday')
    expect(userMsg.accessibilityLabel).not.toMatch(/\bSun\b/)

    expect(rosterRowDisplay(botWithMsg({}, { from: 'user', text: 'Sent a photo', at: todayAt }), UTC_US).inlineText).toBe('You: Sent a photo')

    const unreadReply = rosterRowDisplay(botWithMsg({ activity: { status: 'idle', text: '', unread: true } }, { from: 'bot', text: 'Ready.', at: todayAt }), UTC_US)
    expect(unreadReply.inlineText).toBe('Ready.')
    expect(unreadReply.inlineTone).toBe('foreground')
    expect(unreadReply.boldName).toBe(true)

    const noMsg = rosterRowDisplay(botWithMsg({ function: 'Ships builds' }), UTC_US)
    expect(noMsg.inlineText).toBe('Ships builds')
    expect(noMsg.timeText).toBeNull()
    expect(formatLastMessagePreview({ from: 'bot', text: '   ', at: todayAt })).toBeNull()
    const blankMsg = rosterRowDisplay(botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: '  ', at: todayAt }), UTC_US)
    expect(blankMsg.inlineText).toBe('Ships builds')
    expect(blankMsg.timeText).toBeNull()

    const working = rosterRowDisplay(
      { ...botWithMsg({ activity: { status: 'working', text: 'Running tests', unread: true } }, { from: 'bot', text: 'Old', at: sundayAt }), name: 'Atlas' },
      UTC_US
    )
    expect(working.inlineText).toBe('Running tests')
    expect(working.statusMark).toBe('working')
    expect(working.timeText).toBeNull()
    expect(working.accessibilityLabel).toBe('Atlas, Working, Running tests, Unread')
    expect(
      rosterRowDisplay({ ...botWithMsg({ activity: { status: 'working', text: '', unread: false } }, { from: 'bot', text: 'Old', at: todayAt }), name: 'Atlas' }, UTC_US)
        .accessibilityLabel
    ).toBe('Atlas, Working')

    const withWorker = rosterRowDisplay({ ...botWithMsg({}, { from: 'bot', text: 'Old', at: todayAt }), workers: { count: 1, activity: 'Building' } }, UTC_US)
    expect(withWorker.inlineText).toBe('1 worker · Building')
    expect(withWorker.timeText).toBeNull()

    const waiting = rosterRowDisplay(botWithMsg({ activity: { status: 'waiting', text: '', unread: true } }, { from: 'bot', text: 'Old', at: todayAt }), UTC_US)
    expect(waiting.inlineText).toBe('Waiting for you')
    expect(waiting.timeText).toBeNull()

    const finished = rosterRowDisplay(botWithMsg({ activity: { status: 'finished', text: '', unread: false } }, { from: 'bot', text: 'Old', at: todayAt }), UTC_US)
    expect(finished.inlineText).toBe('Finished')
    expect(finished.statusMark).toBe('finished')
    expect(finished.timeText).toBeNull()

    const failed = rosterRowDisplay(botWithMsg({ activity: { status: 'failed', text: '', unread: false } }, { from: 'bot', text: 'Old', at: todayAt }), UTC_US)
    expect(failed.inlineText).toBe('Failed')
    expect(failed.inlineTone).toBe('destructive')
    expect(failed.timeText).toBeNull()

    const unavailable = rosterRowDisplay(botWithMsg({ runnable: false }, { from: 'bot', text: 'Old', at: todayAt }), UTC_US)
    expect(unavailable.inlineText).toBe('Runtime unavailable')
    expect(unavailable.timeText).toBeNull()

    const inGroup = rosterRowDisplay(
      { ...botWithMsg({}, { from: 'bot', text: 'Old', at: todayAt }), groups: [{ id: 'g1', purpose: 'Rel', round: 1, roundCap: 6, leading: true }] },
      UTC_US
    )
    expect(inGroup.inlineText).toBe('Leading a group')
    expect(inGroup.timeText).toBeNull()
  })

  test('formatRosterTime handles Australian/other locales, DST, and bounded forward clock skew across midnight', () => {
    expect(formatRosterTime(Date.UTC(2026, 10, 25, 3, 45, 0), AU_OPT)).toMatch(/2:15\s*pm/i)
    expect(formatRosterTime(Date.UTC(2026, 10, 24, 12, 0, 0), AU_OPT)).toBe('Tue')
    expect(formatRosterTime(Date.UTC(2026, 10, 24, 12, 0, 0), { ...AU_OPT, weekday: 'long' })).toBe('Tuesday')
    expect(formatRosterTime(Date.UTC(2026, 10, 20, 5, 0, 0), AU_OPT)).toBe('Fri')
    expect(formatRosterTime(Date.UTC(2026, 10, 15, 5, 0, 0), AU_OPT)).toBe('15 Nov')
    expect(formatRosterTime(Date.UTC(2025, 11, 20, 5, 0, 0), AU_OPT)).toMatch(/20\/12\/25|20\/12\/2025/)

    const todayMorning = Date.UTC(2026, 10, 25, 9, 5, 0)
    expect(formatRosterTime(todayMorning, UTC_US)).toMatch(/9:05\s*AM/)
    expect(formatRosterTime(todayMorning, UTC_GB)).toBe('09:05')
    expect(formatRosterTime(Date.UTC(2026, 10, 18, 10, 0, 0), UTC_US)).toBe('Nov 18')
    expect(formatRosterTime(Date.UTC(2026, 10, 18, 10, 0, 0), UTC_GB)).toBe('18 Nov')

    expect(MAX_FORWARD_SKEW_MS).toBe(10 * 60_000)
    const beforeMidnight = Date.UTC(2026, 10, 25, 23, 59, 30)
    expect(formatRosterTime(Date.UTC(2026, 10, 26, 0, 0, 30), { now: beforeMidnight, locale: 'en-GB', timeZone: 'UTC' })).toBe('00:00')
    expect(formatRosterTime(beforeMidnight + MAX_FORWARD_SKEW_MS + 60_000, { now: beforeMidnight, locale: 'en-GB', timeZone: 'UTC' })).toBe('26 Nov')

    expect(formatRosterTime(0, UTC_US)).toBeNull()
    expect(formatRosterTime(-10, UTC_US)).toBeNull()
    expect(formatRosterTime(Number.NaN, UTC_US)).toBeNull()
    expect(formatRosterTime(Date.UTC(2026, 2, 8, 12, 0, 0), { now: Date.UTC(2026, 2, 9, 15, 0, 0), locale: 'en-US', timeZone: 'America/New_York' })).toBe('Sun')
  })

  test('createDayRolloverController re-arms on same-day foreground return, early wake, and midnight rollover', () => {
    let clock = new Date(2026, 10, 25, 22, 0, 0).getTime()
    let nextId = 1
    const timers = new Map<number, { fn: () => void; ms: number }>()
    const cleared: number[] = []
    const changes: number[] = []
    const ctrl = createDayRolloverController({
      now: () => clock,
      setTimeout: (fn, ms) => {
        const id = nextId++
        timers.set(id, { fn, ms })
        return id as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout: id => {
        cleared.push(id as unknown as number)
        timers.delete(id as unknown as number)
      },
      onDayChange: ts => changes.push(ts)
    })

    const fire = (id: number) => {
      const entry = timers.get(id)
      timers.delete(id)
      entry?.fn()
    }

    expect(timers.get(1)?.ms).toBe(msUntilNextLocalDay(clock))
    clock = new Date(2026, 10, 25, 23, 30, 0).getTime()
    ctrl.sync()
    expect(changes).toEqual([])
    expect(cleared).toContain(1)
    expect(timers.get(2)?.ms).toBe(msUntilNextLocalDay(clock))

    clock = new Date(2026, 10, 25, 23, 59, 58).getTime()
    fire(2)
    expect(changes).toEqual([])
    expect(timers.get(3)?.ms).toBe(msUntilNextLocalDay(clock))

    clock = new Date(2026, 10, 26, 0, 0, 2).getTime()
    fire(3)
    expect(changes).toEqual([clock])
    expect(timers.has(4)).toBe(true)

    ctrl.stop()
    expect(timers.size).toBe(0)
    clock = new Date(2026, 10, 27, 8, 0, 0).getTime()
    ctrl.sync()
    expect(changes).toHaveLength(1)
    expect(timers.size).toBe(0)
  })

  test('sameRosterBotDisplay, Roster rollover wiring, and centered AX5 stacked metadata layout', () => {
    const t1 = Date.UTC(2026, 10, 25, 10, 0, 0)
    const a = botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: 'First', at: t1 })
    expect(sameRosterBotDisplay(a, botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: 'First', at: t1 }))).toBe(true)
    expect(sameRosterBotDisplay(a, botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: 'Second', at: t1 }))).toBe(false)
    expect(sameRosterBotDisplay(a, botWithMsg({ function: 'Ships builds' }, { from: 'user', text: 'First', at: t1 }))).toBe(false)
    expect(sameRosterBotDisplay(a, botWithMsg({ function: 'Ships builds' }, { from: 'bot', text: 'First', at: t1 + 60_000 }))).toBe(false)
    expect(sameRosterBotDisplay(a, botWithMsg({ function: 'Ships builds' }))).toBe(false)
    expect(localDayKey(NOW)).toMatch(/^\d{4}-\d{1,2}-\d{1,2}$/)

    const rosterSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/roster.tsx'), 'utf8')
    const rowSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/roster-row.tsx'), 'utf8')
    expect(rosterSource).toContain('createDayRolloverController({ onDayChange: setDayAnchor })')
    expect(rosterSource).toContain("if (next === 'active') rollover.sync()")
    expect(rosterSource).toContain('rollover.stop()')
    expect(rowSource).toContain('const stackMeta = textLines > 1')
    expect(rowSource).toContain('{!stackMeta && metaRow}')
    expect(rowSource).toContain('{stackMeta && metaRow}')
    expect(rowSource).toContain("flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0")
    expect(rowSource).not.toContain('paddingTop: textLines > 1')
  })
})
