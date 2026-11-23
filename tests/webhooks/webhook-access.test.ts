import { expect, test } from 'bun:test'
import type { RunAccessScope } from '../../server/engines/bot-engine'
import { hermesToolsetsForRun } from '../../server/engines/hermes/hermes-access'
import { RUN_TOOLS, runRefusalForChat, TOOL_GROUPS } from '../../server/system/run-access'
import { webhookRunAccess } from '../../server/webhooks/webhook-access'
import { runFixture } from './webhook-fixture'

test('a narrow run emits an empty webhook access scope; each granted group passes neutrally and maps to exact Hermes toolsets', () => {
  const narrow = webhookRunAccess([])
  expect(narrow.access).toEqual({ kind: 'webhook', capabilities: [] })
  expect(hermesToolsetsForRun(narrow.access)).toEqual(['lilbot_system'])
  expect(narrow.prompt).toContain(
    'You cannot read the web, run commands or write files, use computers, read and change memory, manage bots, hand work to other bots, manage routines or manage webhooks: LilBot refuses those tools here.'
  )
  expect(narrow.prompt).not.toMatch(/t3/i)
  expect(webhookRunAccess(['web']).access).toEqual({ kind: 'webhook', capabilities: ['web'] })
  expect(hermesToolsetsForRun(webhookRunAccess(['web']).access)).toEqual(['lilbot_system', 'web'])
  expect(webhookRunAccess(['web']).prompt).toContain("Oscar also lets this webhook's runs read the web.")
  expect(hermesToolsetsForRun(webhookRunAccess(['shell']).access)).toEqual(['lilbot_system', 'terminal', 'code_execution', 'file'])
  expect(webhookRunAccess(['computers']).access).toEqual({ kind: 'webhook', capabilities: ['computers'] })
  expect(hermesToolsetsForRun(webhookRunAccess(['computers']).access)).toEqual(['lilbot_system'])
  expect(webhookRunAccess(['computers']).prompt).toContain("Oscar also lets this webhook's runs use computers.")
  expect(webhookRunAccess(['coding', 'computers']).access).toEqual({ kind: 'webhook', capabilities: ['computers'] })
  expect(hermesToolsetsForRun(webhookRunAccess(['coding', 'computers']).access)).toEqual(['lilbot_system'])
  expect(webhookRunAccess(['coding', 'computers'], true).access).toEqual({ kind: 'webhook', capabilities: ['computers', 'coding'] })
  expect(hermesToolsetsForRun(webhookRunAccess(['coding', 'computers'], true).access)).toEqual(['lilbot_system', 'lilbot_t3'])
  expect(webhookRunAccess([], true).prompt).toContain('code through T3 Code')
  expect(hermesToolsetsForRun(webhookRunAccess(['bots', 'delegation', 'routines', 'webhooks']).access)).toEqual(['lilbot_system'])
  expect(hermesToolsetsForRun(webhookRunAccess(['bots']).access)).not.toContain('memory')
  expect(hermesToolsetsForRun(webhookRunAccess(['memory']).access)).toEqual(['lilbot_system', 'memory'])
  expect(webhookRunAccess(['memory', 'bots']).prompt).toContain("Oscar also lets this webhook's runs read and change memory and manage bots.")
})

test('a webhook limited to computers gets exactly the computer tools on System MCP and refuses every other capability group', () => {
  const beyondOwn = () => false
  for (const tool of [...RUN_TOOLS, ...(TOOL_GROUPS.computers ?? [])]) {
    expect(runRefusalForChat(['computers'], 'b1', tool, {}, beyondOwn), tool).toBeNull()
  }
  const forbidden = [
    'lilbot_about',
    'lilbot_bot_create',
    'lilbot_delegate',
    'lilbot_memory_list',
    'lilbot_routine',
    'lilbot_give_file',
    'lilbot_webhook',
    'lilbot_goal',
    'lilbot_connection'
  ]
  for (const tool of forbidden) {
    expect(runRefusalForChat(['computers'], 'b1', tool, {}, beyondOwn), tool).toContain(`A webhook run cannot use ${tool}`)
  }
})

test('Oscar’s groups are saved on the webhook and its next run starts with the matching neutral access scope', async () => {
  for (const t3On of [false, true]) {
    const f = await runFixture(undefined, t3On)
    try {
      const scopes: (RunAccessScope | undefined)[] = []
      const run = f.engine.runRoutine!
      f.engine.runRoutine = (botId, prompt, options) => {
        scopes.push(options.access)
        return run(botId, prompt, options)
      }
      f.send('{"action":"opened"}')
      await f.tick(f.now() + 10_000)
      await f.webhooks.setCapabilities('b1', f.hook.id, ['shell', 'shell', 'coding'])
      expect(f.store.list('b1')[0].capabilities).toEqual(['coding', 'shell'])
      f.send('{"action":"closed"}')
      await f.tick(f.now() + 120_000)
      expect(scopes).toEqual([
        { kind: 'webhook', capabilities: [] },
        { kind: 'webhook', capabilities: t3On ? ['shell', 'coding'] : ['shell'] }
      ])
      expect(scopes.map(hermesToolsetsForRun)).toEqual([['lilbot_system'], ['lilbot_system', 'terminal', 'code_execution', 'file', ...(t3On ? ['lilbot_t3'] : [])]])
      expect(f.prompts[0]).toContain('LilBot refuses those tools here')
      if (t3On) expect(f.prompts[1]).toContain("Oscar also lets this webhook's runs run commands or write files and code through T3 Code.")
      else {
        expect(f.prompts[1]).toContain("Oscar also lets this webhook's runs run commands or write files.")
        expect(f.prompts[1]).not.toMatch(/t3/i)
      }
    } finally {
      f.clean()
    }
  }
})
