/** The name a device starts with, from the system and browser the page can see: "Mac · Chrome". Pure. */
import { type BrowserFacts, detectSystem } from '../computers/add-this-system'

const SYSTEMS = { macos: 'Mac', linux: 'Linux', windows: 'Windows PC', chromeos: 'Chromebook', android: 'Android', other: '' } as const

/** Order matters: Edge and Opera also say Chrome, and every iOS browser also says Safari. */
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari']
]

export function deviceNameOf(facts: BrowserFacts): string {
  const { system, device } = detectSystem(facts)
  const machine = system.os === 'ios' ? device.replace(/^an? /, '') || 'iPhone' : SYSTEMS[system.os]
  const browser = BROWSERS.find(([pattern]) => pattern.test(facts.userAgent))?.[1] ?? ''
  return [machine, browser].filter(Boolean).join(' · ') || 'Browser'
}
