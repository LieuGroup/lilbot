/** Engine-neutral system prompt assembly: LilBot owns the full prompt a bot receives, keeping each
 *  layer distinct in a fixed, cache-stable prefix order:
 *    1. `<lilbot-base-prompt>` (LilBot's versioned engine-neutral base prompt — identical for every bot)
 *    2. `<lilbot-runtime-tuning>` (optional plain text from the active engine adapter — identical per engine)
 *    3. `<lilbot-system-note>` (bot id, workspace, work-board and `lilbot_*` pointers)
 *    4. `<lilbot-bot-instructions>` (this bot's own identity and brief — who it is, what it does)
 *    5. `<lilbot-skills>` (shared LilBot skills list, byte-bounded)
 *  Text LilBot did not write (instructions, note fields, skills) can never open or close one of these tags,
 *  and every part has its own byte limit, so with the default limit the whole prompt stays under `maxBytes`.
 *  Volatile per-turn context (`<lilbot-memory>`, `[LilBot origin]`, `[LilBot date]`, webhook notices, attachments)
 *  stays in the per-turn message so the cached system-prompt prefix never churns across turns, days or deploys. */
import { BASE_PROMPT_VERSION, LILBOT_BASE_PROMPT } from './base-prompt'

interface PromptSkillEntry {
  name: string
  description: string
}

export interface BotPromptInput {
  botId: string
  botName: string
  workspace: string
  instructions: string
  systemNote: string
  /** Optional engine-specific runtime operating notes passed as plain data from the engine contract. */
  engineTuning?: string
  skills: readonly PromptSkillEntry[]
}

const MAX_OWNED_PROMPT_BYTES = 128_000
const MAX_TUNING_BYTES = 8_000
const MAX_NOTE_BYTES = 8_000
const MAX_INSTRUCTIONS_BYTES = 64_000
const SHORTENED = '\n[shortened by LilBot]'

/** Characters that show nothing: Unicode's default-ignorable class (zero-width and bidi marks, soft hyphen, joiners,
 *  variation selectors, tag characters, Hangul fillers), all format characters, and the blank Braille pattern. */
const INVISIBLE = '\\p{Default_Ignorable_Code_Point}\\p{Cf}\\u2800'
const INVISIBLE_CHARS = new RegExp(`[${INVISIBLE}]`, 'gu')
/** A `<` that would open or close one of LilBot's own tags, allowing spaces, slashes and invisible characters anywhere in it. */
const OWN_TAG_OPEN = new RegExp(`<(?=[\\s${INVISIBLE}/]*${[...'lilbot-'].join(`[${INVISIBLE}]*`)})`, 'giu')
const NOTE_OPEN = '<lilbot-system-note>'
const NOTE_CLOSE = '</lilbot-system-note>'

const byteLen = (text: string) => Buffer.byteLength(text, 'utf8')
const escapeXml = (text: string) => text.replace(INVISIBLE_CHARS, '').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Makes text unable to open or close a LilBot tag, leaving every other character as written. */
const defuseTags = (text: string) => text.replace(OWN_TAG_OPEN, '&lt;')

/** Cuts text to `max` UTF-8 bytes on a character boundary, saying so at the end. */
function clip(text: string, max: number): string {
  if (byteLen(text) <= max) return text
  return `${Buffer.from(text, 'utf8')
    .subarray(0, max - byteLen(SHORTENED))
    .toString('utf8')
    .replace(/\uFFFD+$/, '')}${SHORTENED}`
}

const section = (tag: string, body: string | undefined, max: number) => {
  const trimmed = body?.trim()
  return trimmed ? `<${tag}>\n${clip(defuseTags(trimmed), max)}\n</${tag}>` : ''
}

const buildBaseSection = () => `<lilbot-base-prompt version="${BASE_PROMPT_VERSION}">\n${LILBOT_BASE_PROMPT}\n</lilbot-base-prompt>`

/** The note arrives as LilBot's own block; only its inside is kept, so its fields cannot add tags of their own. */
function buildNoteSection(note: string): string {
  let inner = note.trim()
  if (inner.startsWith(NOTE_OPEN) && inner.endsWith(NOTE_CLOSE)) inner = inner.slice(NOTE_OPEN.length, -NOTE_CLOSE.length)
  return section('lilbot-system-note', inner, MAX_NOTE_BYTES)
}

function buildSkillsSection(skills: readonly PromptSkillEntry[], maxBytes: number): string {
  if (!skills.length || maxBytes <= 0) return ''
  const open =
    '<lilbot-skills>\nShared LilBot skills. Before replying, scan the skills below and load any relevant skill with lilbot_skill_read before starting; create or improve shared skills with lilbot_skill_manage.\n'
  const close = '\n</lilbot-skills>'
  const lines = skills.map(skill => {
    const name = escapeXml(skill.name.trim())
    const desc = escapeXml(skill.description.replace(/[\r\n]+/g, ' ').trim())
    return desc ? `- ${name}: ${desc}` : `- ${name}`
  })
  const full = `${open}${lines.join('\n')}${close}`
  if (byteLen(full) <= maxBytes) return full
  const trailer = `\n(Call lilbot_skill_read with no name to list all ${skills.length} skills.)`
  const budget = maxBytes - byteLen(open) - byteLen(close) - byteLen(trailer)
  if (budget <= 32) return ''
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const add = (kept.length ? 1 : 0) + byteLen(line)
    if (used + add > budget) break
    kept.push(line)
    used += add
  }
  return kept.length ? `${open}${kept.join('\n')}${trailer}${close}` : ''
}

/** Assembles the complete, engine-neutral system prompt for one bot. */
export function assembleBotPrompt(input: BotPromptInput, maxBytes = MAX_OWNED_PROMPT_BYTES): string {
  const parts = [
    buildBaseSection(),
    section('lilbot-runtime-tuning', input.engineTuning, MAX_TUNING_BYTES),
    buildNoteSection(input.systemNote),
    section('lilbot-bot-instructions', input.instructions, Math.min(MAX_INSTRUCTIONS_BYTES, Math.floor(maxBytes / 2)))
  ].filter(Boolean)
  const base = parts.join('\n\n')
  const skillsSection = buildSkillsSection(input.skills, maxBytes - byteLen(base) - 2)
  return skillsSection ? `${base}\n\n${skillsSection}` : base
}
