import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPromptController } from '../../server/app-prompts'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { buildNote } from '../../server/bots/system-note'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import { asEngineRegistry } from '../../server/engines/engine-registry'
import { ScriptedEngine, type ScriptedEngineOptions } from '../../server/engines/scripted/scripted-engine'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { SkillsService } from '../../server/skills/skills-service'

const dirs: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-prompt-failsafe-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function harness(options: {
  enabled: boolean
  promptTuning?: string
  onConfigurePrompt?: ScriptedEngineOptions['onConfigurePrompt']
  hasEngineIdentityText?: (instructions: string) => boolean
}) {
  const root = tempDir()
  const dataDir = join(root, 'data')
  const workspaces = new Workspaces(join(root, 'workspaces'))
  const database = openDatabase(join(dataDir, 'lilbot.db'))
  const store = new BotStore(database)
  const prefs = new BotPrefsStore(database)
  const memory = new MemoryService(new MemoryStore(database))
  const skills = new SkillsService(join(root, 'skills'), database, () => {})
  const engine = new ScriptedEngine({
    promptTuning: options.promptTuning,
    onConfigurePrompt: options.onConfigurePrompt,
    hasEngineIdentityText: options.hasEngineIdentityText
  })
  const engines = asEngineRegistry(engine)
  const note = (bot: { id: string; name: string; model: { provider: string; model: string } | null }) =>
    buildNote({ bot: { id: bot.id, name: bot.name, workspace: workspaces.pathFor(bot.id), model: bot.model } })
  const prompts = createPromptController({ dataDir, engines, workspaces, skills, store, systemNote: note, enabled: options.enabled })
  const bots = new BotService(engines, store, prefs, workspaces, memory, {
    skills,
    systemNote: note,
    prompt: prompts.source,
    cleanupBot: botId => prompts.forgetBot(botId)
  })
  return { bots, engine, prompts, dataDir }
}

describe('BotService prompt ownership and fail-safe behavior', () => {
  test('writes private prompt with base prompt, instructions, note and engine tuning, updates on edit, and deletes on bot removal', async () => {
    const { bots, engine, prompts } = harness({ enabled: true, promptTuning: 'Deferred tools use tool_search.' })
    const created = await bots.createBot({ name: 'Alpha', function: 'Test', instructions: 'Be terse.' })
    const file = prompts.source.pathFor(created.id)
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const content = readFileSync(file, 'utf8')
    expect(content).toContain('<lilbot-base-prompt version="1">')
    expect(content).toContain('<lilbot-runtime-tuning>\nDeferred tools use tool_search.\n</lilbot-runtime-tuning>')
    expect(content).toContain('<lilbot-system-note>')
    expect(content).toContain('<lilbot-bot-instructions>\nBe terse.\n</lilbot-bot-instructions>')
    expect(engine.runtimeOf(`scripted-${created.id}`)?.prompt).toEqual({ enabled: true, botId: created.id, promptFile: file })

    await bots.updateBot({ botId: created.id, instructions: 'Be thorough.' })
    expect(readFileSync(file, 'utf8')).toContain('Be thorough.')

    await bots.deleteBot({ botId: created.id, files: 'delete', privateMemories: 'forget' })
    expect(existsSync(file)).toBe(false)
  })

  test('stays off by default without writing prompt files', async () => {
    const { bots, engine, prompts } = harness({ enabled: false })
    const created = await bots.createBot({ name: 'Beta', function: 'Test', instructions: 'Plain.' })
    expect(existsSync(prompts.source.pathFor(created.id))).toBe(false)
    expect(engine.runtimeOf(`scripted-${created.id}`)?.prompt?.enabled).toBe(false)
    const detail = await bots.getBot(created.id)
    expect(detail.runnable).toBe(true)
    expect(detail.promptFallback).toBeUndefined()
  })

  test('fails safe when configurePrompt throws or reports inactive, recording plain promptFallback without blocking chat', async () => {
    const throwing = harness({
      enabled: true,
      onConfigurePrompt: () => {
        throw new Error('plugin activation failed')
      }
    })
    const b1 = await throwing.bots.createBot({ name: 'FallbackThrow', function: 'Test', instructions: 'Hi.' })
    const d1 = await throwing.bots.getBot(b1.id)
    expect(d1.runnable).toBe(true)
    expect(d1.promptFallback).toBe('prompt setup failed')

    const inactive = harness({
      enabled: true,
      onConfigurePrompt: () => ({ active: false, reason: 'middleware disabled' })
    })
    const b2 = await inactive.bots.createBot({ name: 'FallbackInactive', function: 'Test', instructions: 'Hi.' })
    const d2 = await inactive.bots.getBot(b2.id)
    expect(d2.runnable).toBe(true)
    expect(d2.promptFallback).toBe('middleware disabled')
  })

  test('flags leftover engine identity text in saved instructions without mutating them', async () => {
    const { bots } = harness({ enabled: true, hasEngineIdentityText: text => /default-engine-brand/i.test(text) })
    const b = await bots.createBot({ name: 'Imported', function: 'Test', instructions: 'I am default-engine-brand.' })
    const before = await bots.getBot(b.id)
    expect(before.engineIdentityInInstructions).toBe(true)
    expect(before.instructions).toBe('I am default-engine-brand.')

    await bots.updateBot({ botId: b.id, instructions: 'I am a clean LilBot assistant.' })
    const after = await bots.getBot(b.id)
    expect(after.engineIdentityInInstructions).toBeUndefined()
  })
})
