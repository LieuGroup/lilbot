/** The "about your system" note: a short block LilBot adds to every bot's instructions when it hands them
 *  to an engine, so each bot knows it lives in LilBot and how to use it. The user's own instructions
 *  in LilBot's database never change; engines apply `withNote(instructions, note)`.
 *
 *  This sits at the very top of every engine's prompt prefix, so it holds ONLY this bot's own stable
 *  identity and standing rules. Volatile facts (the running release id, other bots, computers, T3 sign-in
 *  expiry) belong to `lilbot_about`, `lilbot_bots_list` and `lilbot_status`, never here: deploys and
 *  roster or computer changes must never rewrite bot instructions or bust the prompt cache. */
import type { BotModel } from '../../shared/bot-schema'

export interface NoteFacts {
  bot: { id: string; name: string; workspace: string; model: BotModel | null }
  /** Whether legacy T3 Code mode is enabled (`LILBOT_T3_ENABLED=1`). Omit or false when off. */
  t3Enabled?: boolean
}

const OPEN = '<lilbot-system-note>'
const CLOSE = '</lilbot-system-note>'
const BLOCK = new RegExp(`\\n*${OPEN}[\\s\\S]*?${CLOSE}\\n*`, 'g')

export function buildNote({ bot, t3Enabled }: NoteFacts): string {
  return [
    OPEN,
    'About your system, written by LilBot.',
    `You run in LilBot, Oscar's own bot app, on the leader machine. You are "${bot.name}" (id ${bot.id}). Your folder is ${bot.workspace}. Your model is ${bot.model ? `${bot.model.provider}/${bot.model.model}` : "the engine's default"}.`,
    'Choosing a computer: each message ends with a [LilBot origin] line. Use lilbot_guide topic `computers` for the full rules; never guess for a command that changes something, and ask Oscar in your reply if unclear.',
    t3Enabled
      ? 'Coding through T3 Code: check lilbot_status (area `t3`) or lilbot_about for current sign-in status.'
      : 'Coding: do small changes yourself, start a worker with lilbot_delegate (worker: true) for larger work, or hand project work to its developer bot (skill lilbot-coding, lilbot_guide topic `coding`).',
    'Scheduled work: use lilbot_routine, never the engine’s own cron. Runs have full access and need no approvals.',
    'Work board: before any work beyond a reply, however small (changing a file, setting or message; handed over, scheduled or from outside), open an item with lilbot_work. Not for answering a question.',
    'Write its "done" definition before starting, add evidence read from the real result, then finish it (skill lilbot-work).',
    t3Enabled
      ? 'You can operate LilBot yourself with your lilbot_* tools. Use lilbot_about (or lilbot_bots_list and lilbot_status) for live facts — the running release, other bots, computers, T3 Code sign-in and deploy status; lilbot_guide explains each part and the rules for changing LilBot: code changes go through T3 Code, production changes only through `bun run deploy`, and never test on live bots.'
      : 'You can operate LilBot yourself with your lilbot_* tools. Use lilbot_about (or lilbot_bots_list and lilbot_status) for live facts — the running release, other bots, computers and deploy status; lilbot_guide explains each part and the rules for changing LilBot: work on a branch and open a pull request, production changes only through `bun run deploy`, and never test on live bots.',
    CLOSE
  ].join('\n')
}

/** The instructions an engine applies: the user's own text, then the note. */
export const withNote = (instructions: string, note: string) => (instructions.trim() ? `${instructions.trimEnd()}\n\n${note}` : note)

/** An engine's stored instructions without a note LilBot added, for the one-time import of an engine's bots. */
export const withoutNote = (instructions: string) => instructions.replace(BLOCK, '')
