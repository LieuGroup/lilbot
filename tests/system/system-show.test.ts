import { expect, test } from 'bun:test'
import { mkdir, symlink, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatItem } from '../../shared/chat-schema'
import { SHOW_LIMITS } from '../../shared/shown-schema'
import { systemFixture } from './system-fixture'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

async function withFiles(files: Record<string, Buffer | string> = { 'paywall.png': PNG }, show = true) {
  const f = systemFixture({ show })
  await f.workspaces.ensure('b1')
  for (const [name, data] of Object.entries(files)) {
    await mkdir(join(f.workspaces.pathFor('b1'), name, '..'), { recursive: true })
    await writeFile(join(f.workspaces.pathFor('b1'), name), data)
  }
  return f
}
const show = (f: ReturnType<typeof systemFixture>, args: Record<string, unknown> = {}) =>
  f.call('b1', 'lilbot_show', { path: 'paywall.png', caption: 'The yearly plan first', requestId: crypto.randomUUID(), ...args })

test('off by default: no lilbot_show tool is offered while LILBOT_SHOW_ENABLED is unset', async () => {
  const f = await withFiles({}, false)
  expect(f.tools.map(tool => tool.name)).not.toContain('lilbot_show')
  expect((await show(f)).error).toContain('lilbot_show')
})

test('a bot shows an image from its folder: one item in the conversation the call came from, kept by path, searchable by caption and name', async () => {
  const f = await withFiles()
  f.from.set('b1', 'b1-chat')
  const { data } = await show(f)
  expect(data).toMatchObject({ name: 'paywall.png', kind: 'image', size: PNG.length, shown: true })
  const page = f.history.page('b1')
  const item = page.items.find(row => row.item.kind === 'shown')
  expect(item).toMatchObject({ id: `shown:${data.id}`, sessionId: 'b1-chat', author: 'bot' })
  expect(item?.item).toEqual({
    kind: 'shown',
    file: { id: data.id, name: 'paywall.png', kind: 'image', mime: 'image/png', size: PNG.length, caption: 'The yearly plan first', url: `/api/shown/b1/${data.id}` }
  })
  const file = (item?.item as Extract<ChatItem, { kind: 'shown' }> | undefined)?.file
  expect(f.published).toContainEqual({ event: 'chat', chatId: 'b1-chat', data: { type: 'shown', file: file! } })
  expect(f.history.search('b1', 'yearly').map(match => match.id)).toEqual([`shown:${data.id}`])
  expect(f.history.search('b1', 'paywall').map(match => match.id)).toEqual([`shown:${data.id}`])
})

test('after the engine imports the turn, the item keeps its place between the words, the call row is dropped, and a new session keeps it', async () => {
  const f = await withFiles()
  const before = Date.now() - 50
  const { data } = await show(f)
  const after = Date.now() + 50
  const assistant = (text: string) => ({ kind: 'assistant' as const, text })
  f.history.write('b1', 'b1-main', [
    { id: 'hermes:1', at: before, order: 1, item: assistant('Here is the paywall.') },
    { id: 'hermes:2', at: before + 1, order: 2, item: { kind: 'tool', toolId: 'c1', name: 'mcp__lilbot_system__lilbot_show', detail: '', running: false } },
    { id: 'hermes:3', at: after, order: 3, item: assistant('Crashes are down.') }
  ])
  f.history.session('b1', 'b1-next', after + 10)
  f.history.write('b1', 'b1-next', [{ id: 'hermes:9', at: after + 20, order: 1, item: assistant('Next session.') }])
  expect(f.history.page('b1').items.some(row => row.id === 'hermes:2')).toBe(false)
  expect(
    f.history
      .page('b1')
      .items.filter(row => row.sessionId === 'b1-next')
      .map(row => row.id)
  ).toContain('hermes:9')
  expect(
    f.history
      .page('b1')
      .items.filter(row => row.sessionId === 'b1-main')
      .map(row => row.id)
  ).toEqual(['hermes:1', `shown:${data.id}`, 'hermes:3'])
})

test('a long caption is one line, cut at a word', async () => {
  const f = await withFiles()
  const { data } = await show(f, { caption: `First line\n${'word '.repeat(60)}` })
  const item = f.history.page('b1').items.find(row => row.item.kind === 'shown')?.item as { file: { caption: string } }
  expect(item.file.caption.length).toBeLessThanOrEqual(SHOW_LIMITS.captionChars)
  expect(item.file.caption).toMatch(/^First line word( word)*…$/)
  expect(data.shown).toBe(true)
})

test('every refusal says why and places nothing', async () => {
  const f = await withFiles({ 'notes.txt': 'hi', 'clip.mp4': 'x', 'page.html': 'x', 'big.png': 'x', 'dir/a.png': PNG })
  await truncate(join(f.workspaces.pathFor('b1'), 'big.png'), SHOW_LIMITS.bytes.image + 1)
  await truncate(join(f.workspaces.pathFor('b1'), 'page.html'), SHOW_LIMITS.bytes.page + 1)
  await symlink('/etc/hostname', join(f.workspaces.pathFor('b1'), 'link.png'))
  const cases: [Record<string, unknown>, string][] = [
    [{ path: 'notes.txt' }, 'LilBot shows PNG, JPEG, GIF and WebP images'],
    [{ path: 'missing.png' }, 'Use a regular file inside your folder'],
    [{ path: '../other/a.png' }, 'Use a regular file inside your folder'],
    [{ path: 'link.png' }, 'Use a regular file inside your folder'],
    [{ path: 'dir.png' }, 'Use a regular file inside your folder'],
    [{ path: 'big.png' }, 'This image is 20.1 MB; LilBot shows images up to 20 MB'],
    [{ path: 'page.html' }, 'This HTML page is 2.1 MB; LilBot shows HTML pages up to 2 MB']
  ]
  for (const [args, reason] of cases) expect((await show(f, args)).error).toContain(reason)
  expect(f.history.page('b1').items.filter(row => row.item.kind === 'shown')).toEqual([])
})

test('at most four files in one reply; the next reply may show four more', async () => {
  const f = await withFiles()
  for (let i = 0; i < SHOW_LIMITS.perReply; i++) expect((await show(f)).data?.shown).toBe(true)
  expect((await show(f)).error).toContain(`You already showed ${SHOW_LIMITS.perReply} files in this reply`)
  await Bun.sleep(2)
  f.history.event('b1', 'b1-main', { type: 'turn.started' })
  await Bun.sleep(2)
  expect((await show(f)).data?.shown).toBe(true)
})

test('a session Oscar does not see (a routine run) cannot show; the call is refused', async () => {
  const f = await withFiles()
  f.routineStore.create('b1', { requestId: 'daily', description: 'Check sales', schedule: { kind: 'interval', seconds: 600 }, createdBy: 'oscar' }, 0, 5)
  const [run] = f.routineStore.claimDue(Date.now() + 1_000_000)
  f.routineStore.attach(run.id, 'run-chat', Date.now())
  f.from.set('b1', 'run-chat')
  expect((await show(f)).error).toContain('works only in your conversation with the owner')
})

test('the call is matched to the conversation that started it; one nobody reported is refused (#174)', async () => {
  const f = await withFiles()
  const args = { path: 'paywall.png', requestId: 'r1' }
  expect((await f.call('b1', 'lilbot_show', args, false)).error).toContain('Make the same call again')
  f.calls.saw('b1', 'b1-reported', 'mcp__lilbot_system__lilbot_show', args)
  await f.call('b1', 'lilbot_show', args, false)
  expect(f.history.page('b1').items.find(row => row.item.kind === 'shown')?.sessionId).toBe('b1-reported')
})
