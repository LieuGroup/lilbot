import { expect, test } from 'bun:test'
import { HermesEngine } from '../../../server/engines/hermes/hermes-engine'
import { allowedProfile } from '../../../server/engines/hermes/hermes-environment'
import { createRuntime } from '../../../server/engines/hermes/hermes-runtime'

test('production excludes dev profiles, development excludes every other profile', () => {
  for (const environment of ['production', undefined, 'development']) {
    expect(allowedProfile('dev-123', environment)).toBe(environment === 'development')
    expect(allowedProfile('default', environment)).toBe(environment !== 'development')
    expect(allowedProfile('123', environment)).toBe(environment !== 'development')
  }
})
test('development creates prefixed native profiles; refuses binding and deletion before attachment', async () => {
  const previous = process.env.LILBOT_ENV
  process.env.LILBOT_ENV = 'development'
  try {
    const requests: any[] = []
    const id = await createRuntime(
      {
        request: async (_method: any, params: any) => {
          requests.push(params)
          return {}
        }
      } as any,
      {
        id: 'app-id',
        name: 'Test',
        function: '',
        instructions: '',
        model: null,
        reasoningEffort: null,
        permissionMode: 'full-access',
        isDefault: false
      }
    )
    expect(id).toMatch(/^dev-/)
    expect(requests[0].name).toBe(id)
    const engine = new HermesEngine()
    await expect(engine.prepareRuntime('default')).rejects.toThrow('other environment')
    await expect(engine.deleteRuntime('production-id')).rejects.toThrow('other environment')
    expect(() => engine.userSkillPaths('default')).toThrow('other environment')
    // Even a persisted binding or allowlist must not bypass the environment filter.
    ;(engine as any).management.socket = async () => ({ request: async () => ({ profiles: [{ name: 'default' }, { name: 'dev-123' }] }) })
    expect((await (engine as any).profiles()).map((bot: any) => bot.id)).toEqual(['dev-123'])
    await expect(engine.openChat('default', null, {} as any, () => {})).rejects.toThrow('does not exist')
  } finally {
    if (previous === undefined) delete process.env.LILBOT_ENV
    else process.env.LILBOT_ENV = previous
  }
})

test('attach passes the current environment explicitly and rejects a foreign receipt', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'attach-env-'))
  const fake = join(root, 'hermes')
  writeFileSync(
    fake,
    '#!/usr/bin/env python3\nimport os,json\nprint(json.dumps({"state":"ready","url":"ws://127.0.0.1:1234/api/ws","protocols":[],"endpoint":{"profile_id":os.environ["HERMES_HOME"]}}))\n',
    { mode: 0o700 }
  )
  const script = join(root, 'check.ts')
  writeFileSync(
    script,
    `
    process.env.LILBOT_ENV = 'development'
    process.env.HERMES_HOME = '${root}'
    process.env.LILBOT_HERMES_BIN = '${fake}'
    const { attachToHermes } = await import('${import.meta.dir}/../../../server/engines/hermes/hermes-attach')
    await attachToHermes('')
    const { assertDevAttachment } = await import('${import.meta.dir}/../../../server/engines/hermes/hermes-environment')
    for (const grant of [{}, {endpoint:{profile_id:'/production'}}]) {
      let refused = false
      try { assertDevAttachment(grant, '') } catch { refused = true }
      if (!refused) throw new Error('Foreign or unproven gateway accepted')
    }
  `
  )
  try {
    const child = Bun.spawn(['bun', script], { stdout: 'pipe', stderr: 'pipe' })
    const error = await new Response(child.stderr).text()
    expect(await child.exited, error).toBe(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
