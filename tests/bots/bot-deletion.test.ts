import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LilBotError } from '../../shared/protocol'
import { fakeService } from '../helpers/fake-engine'

for (const files of ['archive', 'delete'] as const) {
  for (const privateMemories of ['forget', 'keep'] as const) {
    test(`delete with ${files}/${privateMemories}, preserving shared memory and attribution`, async () => {
      const f = fakeService()
      try {
        await f.service.openChat('b1', undefined, () => {})
        const changesBefore = f.changes()
        await writeFile(join(f.root, 'b1', 'note'), 'hello')
        const own = f.memory.write({ botId: 'b1', kind: 'journal', text: 'A private note.', author: 'user' })
        const shared = f.memory.write({ botId: 'b1', kind: 'profile', text: 'A shared note.', author: 'bot' })
        f.prefs.setPrefs('b1', { pinned: true })
        f.activity.setUnread('b1', true)
        f.activity.observe({ botId: 'b1', chatId: 'c', key: '1', status: 'working', spoke: false })
        f.queue.add('b1', 'c', 'hello', 'hello', Date.now())
        await f.service.deleteBot({ botId: 'b1', files, privateMemories })
        expect(await f.service.listBots()).toEqual([])
        expect(f.runtimeIds.has('b1')).toBe(false)
        expect(f.prefs.mainChat('b1')).toBeNull()
        expect(f.activity.state('b1').unread).toBe(false)
        expect(f.activity.cursor('b1', 'c')).toBeUndefined()
        expect(f.queue.pending()).toEqual([])
        expect(f.prefs.prefs('b1').pinned).toBe(false)
        expect(existsSync(join(f.root, 'b1'))).toBe(false)
        expect(existsSync(join(f.root, '.archive', 'b1', 'note'))).toBe(files === 'archive')
        const panel = await f.service.listMemory('b1')
        expect(panel.facts.some(x => x.id === shared.id)).toBe(true)
        expect(panel.forgotten.some(x => x.id === own.id)).toBe(privateMemories === 'forget')
        expect(f.store.deleted('b1')?.bot.name).toBe('Bot One')
        expect(f.changes() - changesBefore).toBe(1)
        expect(f.memoryChanges()).toBe(1)
        await f.service.deleteBot({ botId: 'b1' })
        if (privateMemories === 'forget') {
          f.service.restoreMemory(own.id)
          expect((await f.service.listMemory('b1')).facts.some(x => x.id === own.id)).toBe(true)
        }
      } finally {
        await rm(f.root, { recursive: true, force: true })
      }
    })
  }
}

test('defaults persist in SQLite and omitted choices use them', async () => {
  const f = fakeService()
  try {
    expect(f.service.deleteDefaults()).toEqual({ files: 'archive', privateMemories: 'forget' })
    f.service.setDeleteDefaults({ files: 'delete', privateMemories: 'keep' })
    await f.service.deleteBot({ botId: 'b1' })
    expect(f.store.deleted('b1')?.choices).toMatchObject({ files: 'delete', privateMemories: 'keep' })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('primary and engine default are refused without mutating anything', async () => {
  const f = fakeService()
  try {
    f.prefs.setPrimaryBot('b1')
    await expect(f.service.deleteBot({ botId: 'b1' })).rejects.toThrow('Choose another primary bot')
    f.prefs.forgetBot('b1')
    f.store.save({ ...f.store.get('b1'), isDefault: true })
    await expect(f.service.deleteBot({ botId: 'b1' })).rejects.toThrow('default bot cannot')
    expect(f.log).toEqual([])
    expect(f.store.deleted('b1')).toBeNull()
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('missing runtime completes; transient engine failure retries with original choices', async () => {
  const f = fakeService()
  try {
    f.engine.deleteRuntime = async () => {
      throw new Error('offline')
    }
    await expect(f.service.deleteBot({ botId: 'b1', files: 'delete' })).rejects.toThrow('offline')
    f.engine.deleteRuntime = async () => {
      throw new LilBotError('bot_not_found', 'Gone')
    }
    await f.service.deleteBot({ botId: 'b1', files: 'archive' })
    expect(f.store.deleted('b1')).toMatchObject({ complete: true, choices: { files: 'delete' } })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('filesystem failure retries without losing private facts or following links', async () => {
  const f = fakeService()
  try {
    await mkdir(join(f.root, 'b1'))
    await mkdir(join(f.root, 'outside'))
    await writeFile(join(f.root, 'outside', 'safe'), 'keep')
    await symlink(join(f.root, 'outside'), join(f.root, 'b1', 'link'))
    await symlink(join(f.root, 'outside'), join(f.root, '.archive'))
    await expect(f.service.deleteBot({ botId: 'b1' })).rejects.toThrow()
    await rm(join(f.root, '.archive'))
    await f.service.deleteBot({ botId: 'b1' })
    expect(existsSync(join(f.root, 'outside', 'safe'))).toBe(true)
    expect(f.store.deleted('b1')?.complete).toBe(true)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('runtime deletion uses the native binding and keeps local data on engine failure', async () => {
  const f = fakeService()
  try {
    f.store.bind('b1', 'native-id')
    let received = ''
    f.engine.deleteRuntime = async id => {
      received = id
      throw new Error('offline')
    }
    f.prefs.setMainChat('b1', 'old-chat')
    await expect(f.service.deleteBot({ botId: 'b1' })).rejects.toThrow('offline')
    expect(received).toBe('native-id')
    expect(f.prefs.mainChat('b1')).toBe('old-chat')
    expect(f.store.deleted('b1')?.complete).toBe(false)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('deleting a workspace symlink removes only the link', async () => {
  const f = fakeService()
  try {
    await mkdir(join(f.root, 'outside'))
    await writeFile(join(f.root, 'outside', 'safe'), 'keep')
    await symlink(join(f.root, 'outside'), join(f.root, 'b1'))
    await f.service.deleteBot({ botId: 'b1', files: 'delete' })
    expect(existsSync(join(f.root, 'outside', 'safe'))).toBe(true)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('browser protocol validates defaults and deletion choices', async () => {
  const { BrowserSession } = await import('../../server/http/browser-session')
  const f = fakeService()
  const frames: any[] = []
  const session = new BrowserSession(f.service, frame => frames.push(frame))
  try {
    await session.handle(JSON.stringify({ id: 1, method: 'bots.deleteDefaults.set', params: { files: 'delete', privateMemories: 'keep' } }))
    await session.handle(JSON.stringify({ id: 2, method: 'bots.deleteDefaults.get', params: {} }))
    expect(frames[1].result).toEqual({ files: 'delete', privateMemories: 'keep' })
    await session.handle(JSON.stringify({ id: 3, method: 'bots.delete', params: { botId: 'b1', files: 'unsafe' } }))
    expect(frames[2].error.code).toBe('invalid_params')
    await session.handle(JSON.stringify({ id: 4, method: 'bots.delete', params: { botId: 'b1' } }))
    expect(frames[3]).toMatchObject({ ok: true, result: { ok: true } })
    expect((await f.service.listMemory('b1')).botName).toBe('Bot One')
  } finally {
    session.close()
    await rm(f.root, { recursive: true, force: true })
  }
})
