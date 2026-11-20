/** The "about your system" note: a short block LilBot adds to every bot's instructions when it hands them
 *  to an engine, so each bot knows it lives in LilBot and how to use it. The user's own instructions
 *  in LilBot's database never change; engines apply `withNote(instructions, note)`.
 *
 *  It is written once per session by every engine, so it holds only what changes rarely and points at the
 *  `lilbot_about` tool for the rest. Keep it about 150 words and keep volatile facts (a computer going
 *  online, a bot's activity) out of it: any change here rewrites the instructions of every bot. */
import type { BotModel } from '../../shared/bot-schema'

export interface NoteFacts {
  bot: { id: string; name: string; workspace: string; model: BotModel | null }
  /** The other bots, in a stable order. */
  others: { name: string; function: string }[]
  /** Names of the registered computers. */
  computers: string[]
  /** `signed in until 2026-12-01`, or why coding through T3 Code is unavailable. */
  coding: string
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
    'Choosing a computer: every message ends with a [LilBot origin] line, written by LilBot, naming the device Oscar sent it from. "My computer", "this computer" or "here" means that device\'s computer; if the device is not a computer, the main computer (lilbot_about shows it); a computer named in the message means that one. If it is offline, none can be told, or the words fit several, ask Oscar which in your reply, listing the computers by name, and do not use a tool to ask; never guess for a command that changes something. Say which computer you used.',
    `Coding through T3 Code: ${coding}.`,
    `LilBot release: ${release}.`,
    'You can operate LilBot yourself with your lilbot_* tools. lilbot_about gives these facts live (they can change during a long session); lilbot_guide explains each part and the rules for changing LilBot: code changes go through T3 Code, production changes only through `bun run deploy`, and never test on live bots.',
    CLOSE
  ].join('\n')
}

/** The instructions an engine applies: the user's own text, then the note. */
export const withNote = (instructions: string, note: string) => (instructions.trim() ? `${instructions.trimEnd()}\n\n${note}` : note)

/** An engine's stored instructions without a note LilBot added, for the one-time import of an engine's bots. */
export const withoutNote = (instructions: string) => instructions.replace(BLOCK, '')
