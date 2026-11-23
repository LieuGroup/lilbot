/** Engine-agnostic conformance suite (Part 3: multi-engine registry, primary-only delete guard, and switchEngine).
 *  Expected failures (`test.failing`) flip to `test` when Lane A P6 lands. */
import { afterEach, describe, expect, test } from 'bun:test'
import type { BotEngine } from '../../server/engines/bot-engine'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { startConformanceApp } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

type RegistryCtor = new (engines: readonly BotEngine[], defaultId?: string) => BotEngine

async function loadRegistry(): Promise<RegistryCtor> {
  const path: string = '../../server/engines/engine-registry'
  const mod = (await import(path)) as { EngineRegistry?: RegistryCtor }
  if (!mod.EngineRegistry) throw new Error('EngineRegistry not exported')
  return mod.EngineRegistry
}

describe('engine conformance: multi-engine registry, deletion guard & switchEngine', () => {
  test.failing('[Lane A P6] multi-engine registry routes bots by engineId and isolates bots on unregistered engines', async () => {
    const EngineRegistry = await loadRegistry()
    const a = new ScriptedEngine({ id: 'scripted-a' })
    const b = new ScriptedEngine({ id: 'scripted-b' })
    const app = await startConformanceApp({ engine: new EngineRegistry([a, b]) })
    cleanups.push(app.close)

    const create = app.services.bots.createBot.bind(app.services.bots) as (
      input: { name: string; function: string; instructions: string },
      parent?: unknown,
      engineId?: string
    ) => Promise<{ id: string }>
    const botA = await create({ name: 'Alpha', function: 'On A', instructions: '' }, undefined, 'scripted-a')
    const botB = await create({ name: 'Beta', function: 'On B', instructions: '' }, undefined, 'scripted-b')
    app.services.store.save({
      id: 'ghost-bot',
      name: 'Ghost',
      function: 'Missing engine',
      instructions: '',
      model: null,
      reasoningEffort: null,
      isDefault: false,
      permissionMode: 'full-access',
      engineId: 'unregistered-engine',
      engineBotId: 'native-ghost'
    })

    await app.services.bots.prepareRuntimes()
    const listed = await app.services.bots.listBots()
    expect(listed.find(bot => bot.id === botA.id)).toMatchObject({ runnable: true })
    expect(listed.find(bot => bot.id === botB.id)).toMatchObject({ runnable: true })
    expect(listed.find(bot => bot.id === 'ghost-bot')).toMatchObject({ runnable: false })

    const chatA = await app.services.bots.openChat(botA.id, undefined, () => {})
    await chatA.send('hello A')
    chatA.close()
    const chatB = await app.services.bots.openChat(botB.id, undefined, () => {})
    await chatB.send('hello B')
    chatB.close()
    expect(a.sessionOf(chatA.snapshot.chatId)?.inputs.at(-1)?.text).toBe('hello A')
    expect(b.sessionOf(chatB.snapshot.chatId)?.inputs.at(-1)?.text).toBe('hello B')
    await expect(app.services.bots.openChat('ghost-bot', undefined, () => {})).rejects.toMatchObject({ code: 'runtime_unavailable' })
  })

  test.failing('[Lane A P6] deletion protection follows LilBot primary bot, not engine isDefault', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const alpha = await app.services.bots.createBot({ name: 'Primary Bot', function: 'Primary', instructions: '' })
    const beta = await app.services.bots.createBot({ name: 'Engine Default Bot', function: 'Secondary', instructions: '' })
    await app.services.bots.setPrimary(alpha.id)
    app.services.store.save({ ...app.services.store.get(beta.id), isDefault: true })

    await expect(app.services.bots.deleteBot({ botId: alpha.id })).rejects.toMatchObject({ code: 'primary_bot' })
    await app.services.bots.deleteBot({ botId: beta.id })
    expect(app.services.store.exists(beta.id)).toBe(false)
  })

  test.failing('[Lane A P6] switchEngine moves a bot to another engine with a fresh session, kept history, and engine_switched divider', async () => {
    const EngineRegistry = await loadRegistry()
    const a = new ScriptedEngine({ id: 'scripted-a' })
    const b = new ScriptedEngine({ id: 'scripted-b' })
    const app = await startConformanceApp({ engine: new EngineRegistry([a, b]) })
    cleanups.push(app.close)

    const bot = await app.services.bots.createBot({ name: 'Mover', function: 'Switches engines', instructions: 'Stay sharp.' })
    await app.services.bots.writeMemory({ botId: bot.id, kind: 'profile', scope: 'bot', text: 'Keep across swap.' })
    const first = await app.services.bots.openChat(bot.id, undefined, () => {})
    await first.send('message before switch')
    first.close()
    for (let i = 0; i < 40; i++) {
      const page = await app.services.bots.historyPage(bot.id)
      if (page.items.some(row => row.item.kind === 'user' && row.item.text === 'message before switch')) break
      await Bun.sleep(50)
    }

    const switcher = app.services.bots as unknown as {
      switchEngine?: (id: string, target: string, opts?: { deleteOldRuntime?: boolean }) => Promise<{ changed: boolean; chatId: string | null; bot: { engineId: string } }>
    }
    expect(typeof switcher.switchEngine).toBe('function')
    const switched = await switcher.switchEngine!(bot.id, 'scripted-b', { deleteOldRuntime: true })
    expect(switched.changed).toBe(true)
    expect(switched.bot.engineId).toBe('scripted-b')
    expect(switched.chatId).toBeTruthy()
    expect(switched.chatId).not.toBe(first.snapshot.chatId)

    const page = await app.services.bots.historyPage(bot.id)
    expect(page.items.some(row => row.item.kind === 'user' && row.item.text === 'message before switch')).toBe(true)
    expect(page.items.some(row => row.item.kind === 'session' && (row.item as { reason?: string }).reason === 'engine_switched')).toBe(true)
    expect((await app.services.bots.listMemory(bot.id)).facts.some(fact => fact.text === 'Keep across swap.')).toBe(true)

    const next = await app.services.bots.openChat(bot.id, undefined, () => {})
    await next.send('message after switch')
    next.close()
    expect(b.sessionOf(next.snapshot.chatId)?.inputs.at(-1)?.text).toBe('message after switch')
  })
})
