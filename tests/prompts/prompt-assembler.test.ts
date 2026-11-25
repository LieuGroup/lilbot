import { describe, expect, test } from 'bun:test'
import { BASE_PROMPT_VERSION, LILBOT_BASE_PROMPT } from '../../server/prompts/base-prompt'
import { assembleBotPrompt } from '../../server/prompts/prompt-assembler'

const baseInput = {
  botId: 'bot-123',
  botName: 'Helper',
  workspace: '/work/bot-123',
  instructions: 'You are concise and direct.',
  systemNote: '<lilbot-system-note>\nYou are "Helper" (id bot-123).\n</lilbot-system-note>',
  skills: [
    { name: 'lilbot-work', description: 'Track work items.' },
    { name: 'lilbot-coding', description: 'Work on branches and PRs.' }
  ]
}

describe('assembleBotPrompt', () => {
  test('assembles versioned base prompt, optional engine tuning, system note, distinct bot instructions, and skills in cache-stable order', () => {
    const prompt = assembleBotPrompt({ ...baseInput, engineTuning: 'Use tool_search for deferred tools.' })
    const order = [
      `<lilbot-base-prompt version="${BASE_PROMPT_VERSION}">`,
      LILBOT_BASE_PROMPT,
      '<lilbot-runtime-tuning>\nUse tool_search for deferred tools.\n</lilbot-runtime-tuning>',
      '<lilbot-system-note>\nYou are "Helper"',
      '<lilbot-bot-instructions>\nYou are concise and direct.\n</lilbot-bot-instructions>',
      '<lilbot-skills>'
    ]
    let prev = -1
    for (const part of order) {
      const idx = prompt.indexOf(part, prev + 1)
      expect(idx).toBeGreaterThan(prev)
      prev = idx
    }
    expect(prompt).not.toMatch(/\bhermes\b|\bnous\b/i)
  })

  test('omits runtime tuning when engine provides none or whitespace only', () => {
    const without = assembleBotPrompt(baseInput)
    const blank = assembleBotPrompt({ ...baseInput, engineTuning: '   \n  ' })
    expect(without).not.toContain('<lilbot-runtime-tuning>')
    expect(blank).toBe(without)
  })

  test('escapes XML brackets and strips invisible unicode in skill entries', () => {
    const prompt = assembleBotPrompt({
      ...baseInput,
      skills: [{ name: 'bad<tag>\u200B', description: 'Line 1\n<script>alert(1)</script>' }]
    })
    expect(prompt).toContain('- bad&lt;tag&gt;: Line 1 &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(prompt).not.toContain('\u200B')
  })

  test('bounds oversized skill lists within maxBytes while preserving base, instructions, note and tuning', () => {
    const manySkills = Array.from({ length: 120 }, (_, i) => ({
      name: `skill-${i}`,
      description: 'Detailed workflow instructions '.repeat(8)
    }))
    const prompt = assembleBotPrompt({ ...baseInput, engineTuning: 'Runtime note.', skills: manySkills }, 3_000)
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(3_000)
    expect(prompt).toContain('<lilbot-base-prompt')
    expect(prompt).toContain('You are concise and direct.')
    expect(prompt).toContain('<lilbot-system-note>')
    expect(prompt).toContain('<lilbot-runtime-tuning>')
    expect(prompt).toContain('Call lilbot_skill_read with no name to list all 120 skills.')
  })
})
