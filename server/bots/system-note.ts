/** The "about your system" note: a short block LilBot adds to every bot's instructions when it hands them
 *  to an engine, so each bot knows it lives in LilBot and how to use it. The user's own instructions
 *  in LilBot's database never change; engines apply `withNote(instructions, note)`.
 *
 *  It is written once per session by every engine, so it holds only what changes rarely and points at the
 *  `lilbot_about` tool for the rest. Keep it about 200 words and keep volatile facts (a computer going
 *  online, a bot's activity) out of it: any change here rewrites the instructions of every bot. */
import type { BotModel } from '../../shared/bot-schema'

export interface NoteFacts {
  bot: { id: string; name: string; workspace: string; model: BotModel | null }
  /** The other bots, in a stable order. */
  others: { name: string; function: string }[]
  /** Names of the registered computers. */
  computers: string[]
  /** `signed in until 2026-12-01`, or why coding through T3 Code is unavailable. Omit when T3 Code is off. */
  coding?: string
  /** The running release, as a short commit id. */
  release: string
}

const OPEN = '<lilbot-system-note>'
const CLOSE = '</lilbot-system-note>'
const BLOCK = new RegExp(`\\n*${OPEN}[\\s\\S]*?${CLOSE}\\n*`, 'g')
const OTHERS_SHOWN = 8
const FUNCTION_CHARS = 50

const brief = (text: string) => (text.length > FUNCTION_CHARS ? `${text.slice(0, FUNCTION_CHARS - 1).trimEnd()}…` : text)

export function buildNote({ bot, others, computers, coding, release }: NoteFacts): string {
  const shown = others.slice(0, OTHERS_SHOWN).map(other => (other.function ? `${other.name} (${brief(other.function)})` : other.name))
  const more = others.length > shown.length ? `, and ${others.length - shown.length} more` : ''
  return [
    OPEN,
    'About your system, written by LilBot when this session started.',
    `You run in LilBot, Oscar's own bot app, on the leader machine. You are "${bot.name}" (id ${bot.id}). Your folder is ${bot.workspace}. Your model is ${bot.model ? `${bot.model.provider}/${bot.model.model}` : "the engine's default"}.`,
    `Other bots: ${shown.join(', ') || 'none'}${more}.`,
    `Computers: ${computers.join(', ') || 'none'}.`,
    'Choosing a computer: each message ends with a [LilBot origin] line. Use lilbot_guide topic `computers` for the full rules; never guess for a command that changes something, and ask Oscar in your reply if unclear.',
    coding
      ? `Coding through T3 Code: ${coding}.`
      : 'Coding: do small changes yourself, start a worker with lilbot_delegate (worker: true) for larger work, or hand project work to its developer bot (skill lilbot-coding, lilbot_guide topic `coding`).',
    'Work board: before any work beyond a reply, however small (changing a file, setting or message; handed over, scheduled or from outside), open an item with lilbot_work. Not for answering a question.',
    'Write its "done" definition before starting, add evidence read from the real result, then finish it (skill lilbot-work).',
    `LilBot release: ${release}.`,
    coding
      ? 'You can operate LilBot yourself with your lilbot_* tools. lilbot_about gives these facts live (they can change during a long session); lilbot_guide explains each part and the rules for changing LilBot: code changes go through T3 Code, production changes only through `bun run deploy`, and never test on live bots.'
      : 'You can operate LilBot yourself with your lilbot_* tools. lilbot_about gives these facts live (they can change during a long session); lilbot_guide explains each part and the rules for changing LilBot: work on a branch and open a pull request, production changes only through `bun run deploy`, and never test on live bots.',
    CLOSE
  ].join('\n')
}

/** The instructions an engine applies: the user's own text, then the note. */
export const withNote = (instructions: string, note: string) => (instructions.trim() ? `${instructions.trimEnd()}\n\n${note}` : note)

/** An engine's stored instructions without a note LilBot added, for the one-time import of an engine's bots. */
export const withoutNote = (instructions: string) => instructions.replace(BLOCK, '')
