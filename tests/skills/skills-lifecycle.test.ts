import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { SkillsService } from '../../server/skills/skills-service'
import { detail, fakeEngine } from '../helpers/fake-engine'

const content = (name: string) => `---\nname: ${name}\ndescription: A workflow\n---\nFollow this procedure.`

test('chat, routine and review refresh the shared catalogue and per-bot off switches before dispatch', async () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/skills-lifecycle-'))
  const db = openDatabase(':memory:')
  try {
    const { engine } = fakeEngine()
    const store = new BotStore(db)
    store.import('test', [{ ...detail, engineId: 'test', engineBotId: 'b1' }])
    const skills = new SkillsService(join(root, 'skills'), db)
    skills.write({ name: 'disabled', action: 'create', content: content('disabled') }, 'b1')
    skills.setEnabled('b1', 'disabled', false)
    const configured: { names: string[]; disabled: string[] }[] = []
    engine.configureSkills = async (_id, settings) => {
      configured.push(settings)
    }
    const bots = new BotService(engine, store, new BotPrefsStore(db), new Workspaces(join(root, 'workspaces')), new MemoryService(new MemoryStore(db)), {
      skills,
      memoryConnection: { url: 'http://localhost:1', tokenFile: '/unused' }
    })
    await bots.prepareRuntimes()
    for (const kind of ['chat', 'routine', 'review'] as const) {
      // A newly added library entry must be picked up even after startup preparation.
      skills.write({ name: kind, action: 'create', content: content(kind) }, 'oscar')
      const assertCatalogue = () => {
        expect(configured.at(-1)?.names).toContain(kind)
        expect(configured.at(-1)?.disabled).toEqual(['disabled'])
      }
      if (kind === 'chat') {
        const original = engine.openChat
        engine.openChat = async (...args) => {
          assertCatalogue()
          return original(...args)
        }
        await bots.openChat('b1', undefined, () => {})
      } else if (kind === 'routine') {
        engine.runRoutine = async () => {
          assertCatalogue()
          return { status: 'completed', text: 'Done' }
        }
        await bots.runRoutine('b1', 'task', { runId: 'run', onChat: () => {} })
      } else {
        engine.reviewMemory = async () => {
          assertCatalogue()
        }
        await bots.reviewMemory('b1', 'review', { onChat: () => {} })
      }
    }
    skills.setEnabled('other', 'disabled', false)
    await bots.deleteBot({ botId: 'b1', files: 'delete' })
    expect(db.query('SELECT * FROM skill_off WHERE bot_id=?').all('b1')).toEqual([])
    expect(skills.disabled('other')).toEqual(['disabled'])
    expect(skills.list('other').find(s => s.name === 'disabled')?.author).toBe('b1')
    expect(skills.read('disabled')['SKILL.md']).toBe(content('disabled'))
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('skills migration upgrades shipped Library schema without losing deliveries or routine history', () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/skills-migration-'))
  const path = join(root, 'db')
  let db = openDatabase(path)
  try {
    db.exec("INSERT INTO library_items VALUES ('file','b1','Title','file.md','page',10,1,'chat',NULL)")
    new BotStore(db).import('test', [{ ...detail, engineId: 'test', engineBotId: 'b1' }])
    db.exec("INSERT INTO routines (id,bot_id,description,schedule,created_by,request_id,next_run_at) VALUES ('r','b1','Task','{}','oscar','request',2)")
    db.exec("INSERT INTO routine_runs (id,routine_id,bot_id,due_at) VALUES ('run','r','b1',1)")
    db.exec("INSERT INTO routine_chats VALUES ('chat','run')")
    db.exec(
      'DROP TABLE computer_payloads; DROP TABLE computer_requests; DROP TABLE computer_bytes; DROP TABLE computer_nonces; DROP TABLE computer_codes; DROP TABLE computers; DROP TABLE thread_chats; DROP TABLE thread_deliveries; DROP TABLE threads; ALTER TABLE bot_prefs DROP COLUMN avatar_face_color; DROP TABLE skills; DROP TABLE skill_off; DROP TABLE skill_imports; DROP TABLE IF EXISTS history_search; DROP TABLE IF EXISTS history_items; DROP TABLE IF EXISTS history_sessions; DROP TABLE IF EXISTS history_events; DROP TABLE IF EXISTS history_imports; DROP TABLE IF EXISTS attachment_messages; DROP TABLE IF EXISTS attachments; PRAGMA user_version = 11'
    )
    const before = ['library_items', 'routines', 'routine_runs', 'routine_chats'].map(table => db.query(`SELECT * FROM ${table}`).all())
    db.close()
    db = openDatabase(path)
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 18 })
    expect(['library_items', 'routines', 'routine_runs', 'routine_chats'].map(table => db.query(`SELECT * FROM ${table}`).all())).toEqual(before)
    expect(db.query('SELECT * FROM skill_off').all()).toEqual([])
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
