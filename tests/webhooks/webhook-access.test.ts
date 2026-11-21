import { expect, test } from 'bun:test'
import { webhookRunAccess } from '../../server/webhooks/webhook-access'
import { runFixture } from './webhook-fixture'

test('a narrow run gets only LilBot’s own server; each granted group adds exactly its engine toolsets', () => {
  const narrow = webhookRunAccess([])
  expect(narrow.toolsets).toEqual(['lilbot_system'])
  expect(narrow.prompt).toContain(
    'You cannot read the web, run commands or write files, use computers, code through T3 Code, read and change memory, manage bots, hand work to other bots, manage routines or manage webhooks: LilBot refuses those tools here.'
  )
  expect(webhookRunAccess(['web']).toolsets).toEqual(['lilbot_system', 'web'])
  expect(webhookRunAccess(['web']).prompt).toContain("Oscar also lets this webhook's runs read the web.")
  expect(webhookRunAccess(['shell']).toolsets).toEqual(['lilbot_system', 'terminal', 'code_execution', 'file'])
  expect(webhookRunAccess(['coding', 'computers']).toolsets).toEqual(['lilbot_system', 'lilbot_computers', 'lilbot_t3'])
  expect(webhookRunAccess(['bots', 'delegation', 'routines', 'webhooks']).toolsets).toEqual(['lilbot_system'])
  expect(webhookRunAccess(['bots']).toolsets).not.toContain('memory')
  expect(webhookRunAccess(['memory']).toolsets).toEqual(['lilbot_system', 'memory'])
  expect(webhookRunAccess(['memory', 'bots']).prompt).toContain("Oscar also lets this webhook's runs read and change memory and manage bots.")
})

test('Oscar’s groups are saved on the webhook and its next run starts with them', async () => {
  const f = await runFixture()
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
    expect(toolsets).toEqual([['lilbot_system'], ['lilbot_system', 'terminal', 'code_execution', 'file', 'lilbot_t3']])
    expect(f.prompts[0]).toContain('LilBot refuses those tools here')
    expect(f.prompts[1]).toContain("Oscar also lets this webhook's runs run commands or write files and code through T3 Code.")
  } finally {
    f.clean()
  }
})
