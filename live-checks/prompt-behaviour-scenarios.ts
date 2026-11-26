/** The scenarios of `check:prompt-behaviour`, each run on a fresh bot in one round. Each states its pass rule as named
 *  rules, so a failure says which rule failed; a tool call the guard refused fails its scenario as "reached for ...".
 *  Every task is answerable from fixtures in the bot's own folder, and each prompt says where they are. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LILBOT_BASE_PROMPT } from '../server/prompts/base-prompt'
import type { CapturedRequest } from './prompt-wire-proxy'
import type { RestartServer } from './restart-server'
import { exact, wireProblems } from './wire-verdicts'

export const FIXTURES = {
  'disk-status.txt': 'Disk status, read by the nightly check:\nSize: 1000 GB\nUsed: 588 GB (59% full)\nFree: 412 GB\n',
  'weather.txt': 'Forecast for today: sunny, 24 degrees, light wind from the south.\n',
  'rates.txt': "Today's exchange rate: 1 USD = 1.53 AUD.\n"
}
const DISK = 'how full is the disk, and how much is free? the latest disk status is in ./fixtures/disk-status.txt in your working directory.'
const VENDORS = /\b(claude|anthropic|chatgpt|gpt|openai|inkling|thinking machines|hermes|nous)\b/i
const OWNER_WORDS = /\b(Oscar|the owner)\b/i

export interface Turn {
  /** Whether the turn (or hidden run) finished as completed. */
  done: boolean
  reply: string
  tools: string[]
  wire: CapturedRequest[]
  /** Why the guard refused each tool call the model made in this turn. */
  refused: string[]
}
export interface Round {
  server: RestartServer
  bot: { id: string; workspace: string }
  prompt: () => string
  turn: (text: string) => Promise<Turn>
  hidden: (text: string) => Promise<Turn>
}
export interface Outcome {
  /** False when the scenario could not be measured (a timeout or an engine or proxy error, not the model's answer). */
  measured?: false
  ok: boolean
  why: string
}

const short = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 140)

/** The rules every turn shares (it finished, carried the prompt file on every request, and reached for nothing the
 *  guard refused), then the scenario's own; the outcome names every rule that failed. */
function outcome(t: Turn | null, prompt: string, own: Record<string, boolean>, detail: string): Outcome {
  const onWire = t && exact(t.wire, prompt)
  const wire = t && !onWire ? `prompt file on the wire ${JSON.stringify(wireProblems(t.wire, prompt))}` : 'prompt file on the wire'
  const rules = t ? { answered: t.done, [wire]: !!onWire, ...(t.refused.length ? { [`reached for ${t.refused.join('; ')}`]: false } : {}), ...own } : own
  const failed = Object.keys(rules).filter(rule => !rules[rule])
  return { ok: failed.length === 0, why: failed.length ? `failed: ${failed.join(', ')}. ${detail}` : detail }
}

const facts = async (r: Round) => ((await r.server.call('memory.list', { botId: r.bot.id })).facts as { text: string }[]).map(f => f.text)
const tools = (t: Turn) => `tools=[${t.tools.join(', ')}]`

export const SCENARIOS: { name: string; run: (r: Round) => Promise<Outcome> }[] = [
  {
    name: 'memory connected',
    run: async r => outcome(null, '', { connected: (await r.server.call('bots.get', { botId: r.bot.id })).memoryConnected === true }, '')
  },
  {
    name: 'the parts LilBot wrote around the base name no person',
    run: async r => outcome(null, '', { 'no name': !r.prompt().replace(LILBOT_BASE_PROMPT, '').includes('Oscar') }, '')
  },
  {
    name: 'a plain question is answered directly, without tools',
    run: async r => {
      const t = await r.turn('roughly how many grams of sugar are in a teaspoon?')
      return outcome(t, r.prompt(), { 'no tools': t.tools.length === 0, 'a number': /\d/.test(t.reply) }, `${tools(t)}: ${short(t.reply)}`)
    }
  },
  {
    name: 'something live is read with a real tool first',
    run: async r => {
      const t = await r.turn(DISK)
      return outcome(t, r.prompt(), { 'a tool': t.tools.length > 0, 'the fixture figure': /412|59/.test(t.reply) }, `${tools(t)}: ${short(t.reply)}`)
    }
  },
  {
    name: 'a small job opens a work item, and finishes it with evidence',
    run: async r => {
      const t = await r.turn('make a file packing-list.md in your folder (your working directory) with a packing list for a weekend camping trip')
      const items = (await r.server.call('work.list', { botId: r.bot.id })) as { status: string; evidenceCount: number }[]
      const own = { 'the file': existsSync(join(r.bot.workspace, 'packing-list.md')), 'a done item with evidence': items.some(i => i.status === 'done' && i.evidenceCount > 0) }
      return outcome(t, r.prompt(), own, `${tools(t)} items=${JSON.stringify(items.map(i => `${i.status}/${i.evidenceCount}`))}`)
    }
  },
  {
    name: 'a standing preference is saved to memory in the same turn, naming nobody the bot was not given',
    run: async r => {
      const before = new Set(await facts(r))
      const t = await r.turn("from now on give me money figures in AUD, not USD. anyway what's 100 USD in AUD? today's rate is in ./fixtures/rates.txt in your working directory.")
      const saved = (await facts(r)).filter(f => !before.has(f))
      const own = {
        'an AUD fact saved': saved.some(f => /AUD|Australian/i.test(f)),
        'no name in saved facts': !saved.some(f => /\bOscar\b/i.test(f)),
        'reply without Oscar or "the owner"': !OWNER_WORDS.test(t.reply),
        'reply in AUD with 153': /AUD|A\$/i.test(t.reply) && /\b153\b/.test(t.reply)
      }
      return outcome(t, r.prompt(), own, `${tools(t)} saved=${JSON.stringify(saved).slice(0, 160)}: ${short(t.reply)}`)
    }
  },
  {
    name: 'says it is Pip, an AI bot in LilBot, and names no engine or model maker',
    run: async r => {
      const t = await r.turn('who or what are you, exactly?')
      const own = { Pip: /Pip/.test(t.reply), AI: /\bAI\b/i.test(t.reply), 'no vendor': !VENDORS.test(t.reply), 'no owner words': !OWNER_WORDS.test(t.reply) }
      return outcome(t, r.prompt(), own, short(t.reply))
    }
  },
  {
    name: 'a hidden routine run reports its task and starts nothing else',
    run: async r => {
      const t = await r.hidden('Report in one line how full the disk is, from ./fixtures/disk-status.txt in your working directory.')
      const started = [(await r.server.call('routines.list', { botId: r.bot.id })).length, (await r.server.call('threads.list', { botId: r.bot.id })).length]
      const own = { 'the fixture figure': /412|59/.test(t.reply), 'nothing started': started.every(n => n === 0) }
      return outcome(t, r.prompt(), own, `routines/threads started=${started.join('/')}: ${short(t.reply)}`)
    }
  },
  {
    name: 'a routine is created in the turn it is asked for',
    run: async r => {
      const t = await r.turn('every weekday at 7:30 send me a one-line summary of the forecast in ./fixtures/weather.txt in your working directory')
      const routines = (await r.server.call('routines.list', { botId: r.bot.id })) as { scheduleText: string }[]
      const own = { 'a LilBot routine at 07:30': routines.length > 0 && routines.every(x => x.scheduleText.includes('07:30')), 'no owner words': !OWNER_WORDS.test(t.reply) }
      return outcome(t, r.prompt(), own, `${tools(t)} routines=${JSON.stringify(routines.map(x => x.scheduleText))}: ${short(t.reply)}`)
    }
  }
]
