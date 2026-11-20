import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import type { BotEngine } from '../../server/engines/bot-engine'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { SkillsService } from '../../server/skills/skills-service'

test('skill preparation uses only bound live bots and Setup reports saved off switches', async () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/skills-api-'))
  const db = openDatabase(':memory:')
  try {
    const store = new BotStore(db)
    store.save({
      id: 'a',
      engineId: 'test',
      engineBotId: 'native-a',
      name: 'A',
      function: '',
      instructions: '',
      model: null,
      reasoningEffort: null,
      isDefault: false,
      permissionMode: 'full-access'
    })
    store.import('test', [])
    const configured: string[] = []
    const engine = {
      id: 'test',
      supportedPermissionModes: ['full-access'],
      applyIdentity: async () => ({ abilities: [], memoryConnected: false }),
      configureSkills: async (id: string) => {
        configured.push(id)
      }
    } as unknown as BotEngine
    const skills = new SkillsService(join(root, 'skills'), db)
    skills.write({ name: 'sample', action: 'create', content: '---\nname: sample\ndescription: sample workflow\n---\nUse it.' }, 'oscar')
    const bots = new BotService(engine, store, new BotPrefsStore(db), new Workspaces(join(root, 'workspaces')), new MemoryService(new MemoryStore(db)), {
      skills,
      memoryConnection: { url: 'http://localhost:1', tokenFile: '/unused' }
    })
    await bots.prepareRuntimes()
    expect(configured).toEqual(['native-a'])
    await bots.skills!.setEnabled('a', 'sample', false)
    expect((await bots.getBot('a')).abilities).toEqual([{ kind: 'skill', id: 'sample', label: 'sample', enabled: false }])
    expect(await bots.skills!.list('a')).toHaveLength(1)
    await expect(bots.skills!.setEnabled('unknown', 'sample', false)).rejects.toThrow()
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
