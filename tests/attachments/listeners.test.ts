import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachmentService } from '../../server/attachments/attachment-service'
import { AttachmentStore } from '../../server/attachments/attachment-store'
import type { ComputerService } from '../../server/computers/computer-service'
import { openDatabase } from '../../server/database/database'
import { startAccessDoor } from '../../server/http/access-door'
import { appRoutes } from '../../server/http/app-routes'
import { startPublicDoor } from '../../server/http/public-door'
import { fakeAccess, token } from '../http/access-fixture'

test('authenticated Access uploads/downloads attachments; public helper listener never serves them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lilbot-attachment-access-'))
  const db = openDatabase(join(root, 'data.db'))
  const service = new AttachmentService(
    new AttachmentStore(db),
    () => root,
    id => id === 'bot'
  )
  const fake = fakeAccess()
  const routes = appRoutes(
    {
      async content() {
        throw new Error('unused')
      }
    },
    root,
    new Set([fake.settings.host]),
    'test',
    service
  )
  const access = startAccessDoor(fake.settings, routes, { message() {} })
  const publicDoor = startPublicDoor({} as ComputerService, 0)
  const headers = { host: fake.settings.host, 'Cf-Access-Jwt-Assertion': token(), origin: `https://${fake.settings.host}` }
  const [file] = service.prepare('bot', [{ name: 'example.txt', mime: 'text/plain', size: 5 }])
  try {
    for (const method of ['GET', 'PUT']) {
      const refused = await fetch(new URL(file.url, access.url), { method, headers: { host: fake.settings.host } })
      expect(refused.status).toBe(403)
      const absent = await fetch(new URL(file.url, publicDoor.url), { method })
      expect(absent.status).toBe(404)
    }
    const uploaded = await fetch(new URL(file.uploadUrl, access.url), { method: 'PUT', headers, body: 'hello' })
    expect((await uploaded.json()).state).toBe('ready')
    const download = await fetch(new URL(file.url, access.url), { headers })
    expect(await download.text()).toBe('hello')
    expect((await fetch(new URL(file.url, access.url), { headers: { ...headers, origin: 'https://evil.example' } })).status).toBe(403)
  } finally {
    access.stop(true)
    publicDoor.stop(true)
    fake.server.stop(true)
    db.close()
    await rm(root, { recursive: true, force: true })
  }
})
