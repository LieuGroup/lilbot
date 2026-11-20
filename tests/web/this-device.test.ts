import { expect, test } from 'bun:test'
import { DeviceName } from '../../shared/device-schema'
import { deviceLine } from '../../web/src/devices/device-line'
import { deviceNameOf } from '../../web/src/devices/device-name'

const facts = (userAgent: string, platform = '', maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints })
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

test('a device starts named after its system and browser, and the name is one the server accepts', () => {
  const names = [
    deviceNameOf(facts(CHROME_MAC, 'MacIntel')),
    deviceNameOf(facts(`${CHROME_MAC} Edg/131.0.0.0`, 'MacIntel')),
    deviceNameOf(facts('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'MacIntel')),
    deviceNameOf(facts('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1')),
    deviceNameOf(facts('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')),
    deviceNameOf(facts('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'MacIntel', 5)),
    deviceNameOf(facts('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Linux x86_64')),
    deviceNameOf(facts('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0')),
    deviceNameOf(facts('curl/8.0'))
  ]
  expect(names).toEqual(['Mac · Chrome', 'Mac · Edge', 'Mac · Safari', 'iPhone · Chrome', 'iPhone · Safari', 'iPad · Safari', 'Linux · Firefox', 'Windows PC · Opera', 'Browser'])
  for (const name of names) expect(DeviceName.safeParse(name).success).toBe(true)
})

test('the line under "This device" says what "my computer" means from here, offline first', () => {
  const computer = { computerId: 'c1', name: 'Alpha', online: true }
  expect(deviceLine({ via: 'linked', ...computer })).toBe('When you write "my computer" from here, bots use Alpha.')
  expect(deviceLine({ via: 'main', ...computer })).toBe('When you write "my computer" from here, bots use your main computer, Alpha.')
  expect(deviceLine({ via: 'none' })).toBe('No main computer yet. From here, bots will ask which computer you mean.')
  expect(deviceLine({ via: 'linked', ...computer, online: false })).toBe('Alpha is offline. Bots will ask before using another computer.')
  expect(deviceLine({ via: 'main', ...computer, online: false })).toBe('Alpha is offline. Bots will ask before using another computer.')
})
