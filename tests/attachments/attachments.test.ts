import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_BYTES, readAttachment, writeAttachment } from '../../server/attachments/attachment-files'
import { AttachmentService } from '../../server/attachments/attachment-service'
import { AttachmentStore } from '../../server/attachments/attachment-store'
import { openDatabase } from '../../server/database/database'
import type { OpenChat } from '../../server/engines/bot-engine'
import { attachmentRoute } from '../../server/http/attachment-routes'
import { methods } from '../../shared/protocol'

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
async function fixture() {
  const root = await mkdtemp('/home/oscar/agent-tmp/lilbot-attachments-')
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const db = openDatabase(join(root, 'test.db'))
  cleanup.push(() => db.close())
  let active = true
  const events: unknown[] = []
  const service = new AttachmentService(
    new AttachmentStore(db),
    () => root,
    id => active && id === 'bot',
    (...args) => events.push(args)
  )
  return {
    root,
    db,
    service,
    events,
    delete: () => {
      active = false
    }
  }
}
function body(text: string | Uint8Array) {
  return new Request('http://localhost:9000/api/attachments/bot/id', { method: 'PUT', body: typeof text === 'string' ? text : new Uint8Array(text) })
}
async function upload(service: AttachmentService, name = 'notes.txt', text = 'FILE_OK') {
  const [file] = service.prepare('bot', [{ name, size: Buffer.byteLength(text), mime: 'text/plain' }])
  return service.upload('bot', file.id, body(text))
}

test('server limits, per-file refusal, safe generated names and send validation', async () => {
  const { service, root } = await fixture()
  const files = service.prepare('bot', [
    { name: '../escape.txt', size: 1, mime: 'text/plain' },
    { name: 'big', size: MAX_BYTES + 1, mime: '' },
    ...Array.from({ length: 9 }, () => ({ name: 'fine.txt', size: 1, mime: 'text/plain' }))
  ])
  expect(files[0].reason?.code).toBe('invalid_name')
  expect(files[1].reason?.code).toBe('file_too_large')
  expect(files[10].reason?.code).toBe('too_many_files')
  expect(files[2].state).toBe('uploading')
  const ready = await upload(service, 'my original name.txt')
  expect(ready.state).toBe('ready')
  expect((await readdir(join(root, 'attachments')))[0]).not.toBe(ready.name)
  expect(await service.content('bot', ready.id)).toMatchObject({ name: ready.name, mime: 'text/plain' })
  expect(methods['chat.send'].safeParse({ chatId: 'c', text: '', attachmentIds: [ready.id] }).success).toBe(false)
  expect(methods['chat.send'].safeParse({ chatId: 'c', text: 'hi', attachmentIds: Array(11).fill(ready.id), messageId: crypto.randomUUID() }).success).toBe(false)
})

test('streamed oversize and wrong size are refused and partial files are removed', async () => {
  const { service, root } = await fixture()
  const [file] = service.prepare('bot', [{ name: 'large', size: 1, mime: '' }])
  expect((await service.upload('bot', file.id, body(new Uint8Array(MAX_BYTES + 1)))).reason?.code).toBe('file_too_large')
  const [wrong] = service.prepare('bot', [{ name: 'wrong', size: 10, mime: '' }])
  expect((await service.upload('bot', wrong.id, body('short'))).reason?.code).toBe('size_mismatch')
  expect(await readdir(join(root, 'attachments'))).toEqual([])
})

test('wrong Host, Origin, cross-site fetch and unsupported verbs are refused', async () => {
  const { service } = await fixture()
  const file = await upload(service)
  const url = `http://localhost:9000${file.url}`
  for (const headers of [{ host: 'evil' }, { host: 'localhost:9000', origin: 'https://evil' }, { host: 'localhost:9000', 'sec-fetch-site': 'cross-site' }] as Record<
    string,
    string
  >[]) {
    for (const method of ['GET', 'PUT']) expect((await attachmentRoute(new Request(url, { method, headers }), new Set(['localhost:9000']), service)).status).toBe(403)
  }
  const response = await attachmentRoute(new Request(url, { headers: { host: 'localhost:9000' } }), new Set(['localhost:9000']), service)
  expect(await response.text()).toBe('FILE_OK')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('content-disposition')).toContain('attachment;')
})

test('root/folder/file symlinks and a folder swapped mid-stream cannot escape', async () => {
  const { root } = await fixture()
  const outside = join(root, 'outside'),
    workspace = join(root, 'workspace')
  await mkdir(outside)
  await mkdir(workspace)
  await symlink(outside, join(workspace, 'attachments'))
  await expect(writeAttachment(workspace, 'generated', body('x').body, 1)).rejects.toThrow()
  expect(await readdir(outside)).toEqual([])
  await rm(join(workspace, 'attachments'))
  await mkdir(join(workspace, 'attachments'))
  await writeFile(join(outside, 'target'), 'safe')
  await symlink(join(outside, 'target'), join(workspace, 'attachments', 'generated'))
  await expect(writeAttachment(workspace, 'generated', body('x').body, 1)).rejects.toThrow()
  await expect(readAttachment(workspace, 'generated', '')).rejects.toThrow()
  await symlink(outside, join(root, 'linked-root'))
  await expect(writeAttachment(join(root, 'linked-root'), 'generated', body('x').body, 1)).rejects.toThrow()
  let resume: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    resume = resolve
  })
  let begun: () => void = () => {}
  const started = new Promise<void>(resolve => {
    begun = resolve
  })
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      begun()
      await gate
      controller.enqueue(Buffer.from('x'))
      controller.close()
    }
  })
  const writing = writeAttachment(workspace, 'swapped', stream, 1)
  await started
  // pull may start before open; wait until the generated file exists before the swap.
  for (let i = 0; !(await readdir(join(workspace, 'attachments'))).includes('swapped') && i < 100; i++) await Bun.sleep(2)
  await rename(join(workspace, 'attachments'), join(workspace, 'old'))
  await symlink(outside, join(workspace, 'attachments'))
  resume()
  await expect(writing).rejects.toThrow()
  expect(await readdir(outside)).toEqual(['target'])
})

test('sent metadata survives new service/DB connection, repeated text and another device; deletion revokes access', async () => {
  const f = await fixture()
  const file = await upload(f.service)
  let wire = ''
  const chat: OpenChat = {
    imageSupport: 'unsupported',
    snapshot: { botId: 'bot', chatId: 'chat', title: '', workspace: f.root, running: false, items: [] },
    async send(text) {
      wire = text
    },
    async stop() {},
    close() {}
  }
  const messageId = crypto.randomUUID()
  const message = await f.service.send(chat, 'hello', [file.id], messageId)
  expect(message.images).toEqual({ support: 'unsupported', imageCount: 0 })
  const db = openDatabase(join(f.root, 'test.db'))
  cleanup.push(() => db.close())
  const reopened = new AttachmentService(
    new AttachmentStore(db),
    () => f.root,
    () => true
  )
  const snapshot = reopened.merge({
    ...chat.snapshot,
    items: [
      { kind: 'user', text: 'hello' },
      { kind: 'user', text: wire }
    ]
  })
  expect(snapshot.items[0]).toEqual({ kind: 'user', text: 'hello' })
  expect(snapshot.items[1]).toMatchObject({ messageId, attachments: [file], text: 'hello' })
  expect(f.events).toHaveLength(1)
  await f.service.send(chat, 'hello', [file.id], messageId)
  await expect(f.service.send(chat, 'changed', [file.id], messageId)).rejects.toThrow('already used')
  f.delete()
  await expect(f.service.content('bot', file.id)).rejects.toThrow('does not exist')
})

test('image count and an unsupported-model signal are kept on the sent message', async () => {
  const { service, root } = await fixture()
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const [file] = service.prepare('bot', [{ name: 'screenshot.png', size: png.length, mime: 'text/plain' }])
  const ready = await service.upload('bot', file.id, body(png))
  expect(ready.mime).toBe('image/png')
  const chat: OpenChat = {
    imageSupport: 'unsupported',
    snapshot: { botId: 'bot', chatId: 'chat', title: '', workspace: root, running: false, items: [] },
    async send() {},
    async stop() {},
    close() {}
  }
  const message = await service.send(chat, '', [file.id], crypto.randomUUID())
  expect(message.images).toEqual({ support: 'unsupported', imageCount: 1 })
  expect(message.attachments[0].state).toBe('ready')
})
