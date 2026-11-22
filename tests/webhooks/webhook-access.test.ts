import { expect, test } from 'bun:test'
import { webhookRunAccess } from '../../server/webhooks/webhook-access'
import { runFixture } from './webhook-fixture'

test('a narrow run gets only LilBot’s own server; each granted group adds its engine toolsets and T3 appears only when enabled', () => {
  const narrow = webhookRunAccess([])
  expect(narrow.toolsets).toEqual(['lilbot_system'])
  expect(narrow.prompt).toContain(
    'You cannot read the web, run commands or write files, use computers, read and change memory, manage bots, hand work to other bots, manage routines or manage webhooks: LilBot refuses those tools here.'
  )
  expect(narrow.prompt).not.toMatch(/t3/i)
  expect(webhookRunAccess(['web']).toolsets).toEqual(['lilbot_system', 'web'])
  expect(webhookRunAccess(['web']).prompt).toContain("Oscar also lets this webhook's runs read the web.")
  expect(webhookRunAccess(['shell']).toolsets).toEqual(['lilbot_system', 'terminal', 'code_execution', 'file'])
  expect(webhookRunAccess(['coding', 'computers']).toolsets).toEqual(['lilbot_system', 'lilbot_computers'])
  expect(webhookRunAccess(['coding', 'computers'], true).toolsets).toEqual(['lilbot_system', 'lilbot_computers', 'lilbot_t3'])
  expect(webhookRunAccess([], true).prompt).toContain('code through T3 Code')
  expect(webhookRunAccess(['bots', 'delegation', 'routines', 'webhooks']).toolsets).toEqual(['lilbot_system'])
  expect(webhookRunAccess(['bots']).toolsets).not.toContain('memory')
  expect(webhookRunAccess(['memory']).toolsets).toEqual(['lilbot_system', 'memory'])
  expect(webhookRunAccess(['memory', 'bots']).prompt).toContain("Oscar also lets this webhook's runs read and change memory and manage bots.")
})

test('Oscar’s groups are saved on the webhook and its next run starts with them', async () => {
  for (const t3On of [false, true]) {
    const f = await runFixture(undefined, t3On)
    try {
      const toolsets: (string[] | undefined)[] = []
      const run = f.engine.runRoutine!
      f.engine.runRoutine = (botId, prompt, options) => {
        toolsets.push(options.toolsets)
        return run(botId, prompt, options)
      }
      f.send('{"action":"opened"}')
      await f.tick(f.now() + 10_000)
      await f.webhooks.setCapabilities('b1', f.hook.id, ['shell', 'shell', 'coding'])
      expect(f.store.list('b1')[0].capabilities).toEqual(['coding', 'shell'])
      f.send('{"action":"closed"}')
      await f.tick(f.now() + 120_000)
      expect(toolsets).toEqual([['lilbot_system'], ['lilbot_system', 'terminal', 'code_execution', 'file', ...(t3On ? ['lilbot_t3'] : [])]])
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
