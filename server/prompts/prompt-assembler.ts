/** Engine-neutral system prompt assembly: LilBot owns the full prompt a bot receives, keeping each
 *  layer distinct in a fixed, cache-stable prefix order:
 *    1. `<lilbot-base-prompt>` (LilBot's versioned engine-neutral base prompt — identical for every bot)
 *    2. `<lilbot-runtime-tuning>` (optional plain text from the active engine adapter — identical per engine)
 *    3. `<lilbot-system-note>` (bot id, workspace, work-board and `lilbot_*` pointers)
 *    4. `<lilbot-bot-instructions>` (this bot's own identity and brief — who it is, what it does)
 *    5. `<lilbot-skills>` (shared LilBot skills list, byte-bounded)
 *  Volatile per-turn context (`<lilbot-memory>`, `[LilBot origin]`, webhook notices, attachments) stays
 *  in per-turn `api_text` so the cached system-prompt prefix never churns across turns or deploys. */
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

const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g
const byteLen = (text: string) => Buffer.byteLength(text, 'utf8')
const escapeXml = (text: string) => text.replace(INVISIBLE_CHARS, '').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const buildBaseSection = () => `<lilbot-base-prompt version="${BASE_PROMPT_VERSION}">\n${LILBOT_BASE_PROMPT}\n</lilbot-base-prompt>`

function buildTuningSection(tuning: string | undefined): string {
  const trimmed = tuning?.trim()
  return trimmed ? `<lilbot-runtime-tuning>\n${trimmed}\n</lilbot-runtime-tuning>` : ''
}

function buildInstructionsSection(instructions: string): string {
  const trimmed = instructions.trimEnd()
  return trimmed.trim() ? `<lilbot-bot-instructions>\n${trimmed}\n</lilbot-bot-instructions>` : ''
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
  const parts: string[] = [buildBaseSection()]
  const tuning = buildTuningSection(input.engineTuning)
  if (tuning) parts.push(tuning)
  const note = input.systemNote.trim()
  if (note) parts.push(note)
  const instructions = buildInstructionsSection(input.instructions)
  if (instructions) parts.push(instructions)
  const base = parts.join('\n\n')
  const remaining = maxBytes - byteLen(base) - 2
  const skillsSection = buildSkillsSection(input.skills, remaining)
  return skillsSection ? `${base}\n\n${skillsSection}` : base
}
