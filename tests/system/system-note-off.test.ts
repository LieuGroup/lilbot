import { expect, test } from 'bun:test'
import type { BotRecord } from '../../server/bots/bot-store'
import { buildNote } from '../../server/bots/system-note'
import { Workspaces } from '../../server/bots/workspaces'
import { systemNote } from '../../server/system/system-note-facts'

/** The note every bot gets while LilBot does not own its prompt (the default), exactly as before the base prompt. */
const OFF =
  '<lilbot-system-note>\nAbout your system, written by LilBot.\nYou run in LilBot, Oscar\'s own bot app, on the leader machine. You are "Bot One" (id b1). Your folder is /srv/lilbot/workspaces/b1. Your model is cliproxyapi/anthropic/claude-sonnet-5-5.\nChoosing a computer: each message ends with a [LilBot origin] line. Use lilbot_guide topic `computers` for the full rules; never guess for a command that changes something, and ask Oscar in your reply if unclear.\nCoding: do small changes yourself, start a worker with lilbot_delegate (worker: true) for larger work, or hand project work to its developer bot (skill lilbot-coding, lilbot_guide topic `coding`).\nScheduled work: use lilbot_routine, never the engine’s own cron. Runs have full access and need no approvals.\nWork board: before any work beyond a reply, however small (changing a file, setting or message; handed over, scheduled or from outside), open an item with lilbot_work. Not for answering a question.\nWrite its "done" definition before starting, add evidence read from the real result, then finish it (skill lilbot-work).\nYou can operate LilBot yourself with your lilbot_* tools. Use lilbot_about (or lilbot_bots_list and lilbot_status) for live facts — the running release, other bots, computers and deploy status; lilbot_guide explains each part and the rules for changing LilBot: work on a branch and open a pull request, production changes only through `bun run deploy`, and never test on live bots.\n</lilbot-system-note>'
const OFF_T3_DEFAULT_MODEL =
  '<lilbot-system-note>\nAbout your system, written by LilBot.\nYou run in LilBot, Oscar\'s own bot app, on the leader machine. You are "Bot One" (id b1). Your folder is /srv/lilbot/workspaces/b1. Your model is the engine\'s default.\nChoosing a computer: each message ends with a [LilBot origin] line. Use lilbot_guide topic `computers` for the full rules; never guess for a command that changes something, and ask Oscar in your reply if unclear.\nCoding through T3 Code: check lilbot_status (area `t3`) or lilbot_about for current sign-in status.\nScheduled work: use lilbot_routine, never the engine’s own cron. Runs have full access and need no approvals.\nWork board: before any work beyond a reply, however small (changing a file, setting or message; handed over, scheduled or from outside), open an item with lilbot_work. Not for answering a question.\nWrite its "done" definition before starting, add evidence read from the real result, then finish it (skill lilbot-work).\nYou can operate LilBot yourself with your lilbot_* tools. Use lilbot_about (or lilbot_bots_list and lilbot_status) for live facts — the running release, other bots, computers, T3 Code sign-in and deploy status; lilbot_guide explains each part and the rules for changing LilBot: code changes go through T3 Code, production changes only through `bun run deploy`, and never test on live bots.\n</lilbot-system-note>'

test('with the setting off, every bot is told exactly what it was told before, byte for byte', () => {
  const bot = { id: 'b1', name: 'Bot One', workspace: '/srv/lilbot/workspaces/b1' }
  expect(buildNote({ bot: { ...bot, model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' } } })).toBe(OFF)
  expect(buildNote({ bot: { ...bot, model: null }, t3Enabled: true })).toBe(OFF_T3_DEFAULT_MODEL)
})

test('the app’s default note wiring is the unchanged note; only LilBot’s own prompt gets the short one', () => {
  const workspaces = new Workspaces('/srv/lilbot/workspaces')
  const record: BotRecord = {
    id: 'b1',
    name: 'Bot One',
    function: '',
    instructions: 'Be brief.',
    model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' },
    reasoningEffort: null,
    isDefault: false,
    permissionMode: 'full-access',
    engineId: 'test',
    engineBotId: 'native-b1'
  }
  expect(systemNote({ workspaces })(record)).toBe(OFF)
  const short = systemNote({ workspaces }, true)(record)
  expect(short).not.toBe(OFF)
  expect(short).toContain('lilbot_about names your current model.')
  expect(short).not.toMatch(/Your model is|before any work beyond a reply|Oscar/)
  expect(systemNote({ workspaces, t3Enabled: true }, true)(record)).not.toContain('Oscar')
})
