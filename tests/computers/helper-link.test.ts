import { expect, test } from 'bun:test'
import { retire } from '../../helper/retire'
import { uninstallPlan } from '../../helper/service'
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

test('uninstall boots out by label before removing the plist; systemd disables, removes the unit, then stops last; none is required', () => {
  const mac = uninstallPlan(true, 501, '/agents/info.lilbot.helper.plist')
  expect(mac).toEqual([{ args: ['launchctl', 'bootout', 'gui/501/info.lilbot.helper'] }, { remove: '/agents/info.lilbot.helper.plist' }])
  const linux = uninstallPlan(false, 1000, '/units/lilbot-helper.service')
  expect(linux.map(step => ('remove' in step ? 'remove' : step.args[2]))).toEqual(['disable', 'remove', 'daemon-reload', 'stop'])
  expect(linux.every(step => 'remove' in step || !step.required)).toBe(true)
})

test('a baked helper installs only at its own door', () => {
  expect(() => assertBakedDoor('https://door.example/', settings)).not.toThrow()
  expect(() => assertBakedDoor('https://evil.example', settings)).toThrow()
  expect(() => assertBakedDoor('https://door.example:8443', settings)).toThrow()
  expect(() => assertBakedDoor('https://evil.example', null)).not.toThrow()
})
