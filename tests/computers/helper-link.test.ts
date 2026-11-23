import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retire } from '../../helper/retire'
import { uninstallPlan, uninstallService } from '../../helper/service'
import { assertBakedDoor, type HelperSettings } from '../../helper/settings'
import { type LinkPorts, link } from '../../helper/setup'
import type { SetupWindow } from '../../helper/setup-window'

const settings: HelperSettings = { door: 'https://door.example', origins: ['https://bot.example'], port: 1, fingerprint: 'f'.repeat(64) }
const url = `lilbot-helper://register#${'A'.repeat(32)}`

function fakes(registered: boolean) {
  const calls: string[] = []
  const shown: string[] = []
  const ports: LinkPorts = {
    registered: () => registered,
    register: async () => void calls.push('register'),
    install: async () => void calls.push('install')
  }
  const window: SetupWindow = { ask: async () => null, show: async message => void shown.push(message), close() {} }
  return { calls, shown, ports, window }
}

test('a link on a registered computer changes nothing: no registration, no reinstall or restart', async () => {
  const f = fakes(true)
  await link(settings, url, f.window, f.ports)
  expect(f.calls).toEqual([])
  expect(f.shown).toEqual(['This computer is connected to LilBot. You can close this window.'])
})

test('a link on a new computer registers, then installs; a malformed link does neither', async () => {
  const f = fakes(false)
  await link(settings, url, f.window, f.ports)
  expect(f.calls).toEqual(['register', 'install'])
  await expect(link(settings, 'lilbot-helper://register#short', f.window, f.ports)).rejects.toThrow()
  expect(f.calls).toEqual(['register', 'install'])
})

test('retiring removes the identity before the service, so an interrupted removal cannot leave a keyless helper restarting', async () => {
  const order: string[] = []
  await retire({ removeIdentity: () => void order.push('identity'), uninstall: async () => void order.push('service') })
  expect(order).toEqual(['identity', 'service'])
})

test('uninstall removes the plist before booting out by label on macOS; systemd disables, removes the unit, then stops last; none is required', () => {
  const mac = uninstallPlan(true, 501, '/agents/info.lilbot.helper.plist')
  expect(mac).toEqual([{ remove: '/agents/info.lilbot.helper.plist' }, { args: ['launchctl', 'bootout', 'gui/501/info.lilbot.helper'] }])
  expect(mac.every(step => 'remove' in step || !step.required)).toBe(true)
  const linux = uninstallPlan(false, 1000, '/units/lilbot-helper.service')
  expect(linux.map(step => ('remove' in step ? 'remove' : step.args[2]))).toEqual(['disable', 'remove', 'daemon-reload', 'stop'])
  expect(linux.every(step => 'remove' in step || !step.required)).toBe(true)
})

test('macOS retirement deletes identity and LaunchAgent plist before launchctl bootout can kill the helper', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helper-mac-retire-'))
  try {
    const identity = join(root, 'identity.json')
    const plist = join(root, 'Library/LaunchAgents/info.lilbot.helper.plist')
    mkdirSync(join(root, 'Library/LaunchAgents'), { recursive: true })
    writeFileSync(identity, '{}')
    writeFileSync(plist, '<plist/>')
    const seen: { args: string[]; identityGone: boolean; plistGone: boolean }[] = []
    await expect(
      retire({
        removeIdentity: () => rmSync(identity, { force: true }),
        uninstall: () =>
          uninstallService({
            mac: true,
            home: root,
            uid: 501,
            command: async args => {
              seen.push({ args, identityGone: !existsSync(identity), plistGone: !existsSync(plist) })
              throw new Error('terminated by launchctl bootout')
            }
          })
      })
    ).rejects.toThrow('terminated by launchctl bootout')
    expect(seen).toEqual([{ args: ['launchctl', 'bootout', 'gui/501/info.lilbot.helper'], identityGone: true, plistGone: true }])
    expect(existsSync(identity)).toBe(false)
    expect(existsSync(plist)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('macOS plain terminal uninstall removes the plist, boots out by label, and retains local identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helper-mac-uninstall-'))
  try {
    const identity = join(root, 'identity.json')
    const plist = join(root, 'Library/LaunchAgents/info.lilbot.helper.plist')
    mkdirSync(join(root, 'Library/LaunchAgents'), { recursive: true })
    writeFileSync(identity, '{}')
    writeFileSync(plist, '<plist/>')
    const calls: string[][] = []
    await uninstallService({
      mac: true,
      home: root,
      uid: 501,
      command: async args => {
        expect(existsSync(plist)).toBe(false)
        calls.push(args)
      }
    })
    expect(calls).toEqual([['launchctl', 'bootout', 'gui/501/info.lilbot.helper']])
    expect(existsSync(plist)).toBe(false)
    expect(existsSync(identity)).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a baked helper installs only at its own door', () => {
  expect(() => assertBakedDoor('https://door.example/', settings)).not.toThrow()
  expect(() => assertBakedDoor('https://evil.example', settings)).toThrow()
  expect(() => assertBakedDoor('https://door.example:8443', settings)).toThrow()
  expect(() => assertBakedDoor('https://evil.example', null)).not.toThrow()
})
