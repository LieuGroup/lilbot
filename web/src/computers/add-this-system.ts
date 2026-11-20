/** What the page can tell about the machine it runs on, and the words that follow from it. Pure. */
import type { AddThisSystem, HelperDownload } from '../../../shared/computer-add-schema'

export interface BrowserFacts {
  userAgent: string
  platform: string
  maxTouchPoints: number
  /** From `userAgentData` when the browser has it: `arm` or `x86`. */
  architecture?: string
}

export interface Detected {
  system: AddThisSystem
  /** For the unsupported state: "an iPhone". Empty when the page cannot tell. */
  device: string
}

const archOf = (facts: BrowserFacts): AddThisSystem['arch'] => {
  const text = `${facts.architecture ?? ''} ${facts.userAgent}`.toLowerCase()
  if (/\b(arm|arm64|aarch64)\b/.test(text)) return 'arm64'
  if (/\b(x86|x86_64|x64|amd64)\b/.test(text)) return 'x64'
  return 'unknown'
}

/** Safari reports an Intel Mac whatever the chip, so `unknown` is normal there. An iPad asking for the desktop site
 *  looks like a Mac; touch points tell them apart. */
export function detectSystem(facts: BrowserFacts): Detected {
  const agent = facts.userAgent
  const found = (os: AddThisSystem['os'], device = ''): Detected => ({ system: { os, arch: archOf(facts) }, device })
  if (/iPhone|iPod/.test(agent)) return found('ios', 'an iPhone')
  if (/iPad/.test(agent) || (/Mac/.test(facts.platform + agent) && facts.maxTouchPoints > 1)) return found('ios', 'an iPad')
  if (/Android/.test(agent)) return found('android', 'an Android device')
  if (/CrOS/.test(agent)) return found('chromeos', 'a Chromebook')
  if (/Windows/.test(agent)) return found('windows', 'a Windows PC')
  if (/Macintosh|Mac OS X/.test(agent)) return found('macos')
  if (/Linux|X11/.test(agent)) return found('linux')
  return found('other')
}

/** Read from the open page, not at import, so the check happens when the dialog opens. */
export function browserFacts(): BrowserFacts {
  return { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }
}

interface UserAgentData {
  getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>
}

/** The same facts plus the chip, which only Chromium browsers will say. */
export async function browserFactsWithChip(): Promise<BrowserFacts> {
  const facts = browserFacts()
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData
  try {
    return { ...facts, architecture: (await data?.getHighEntropyValues(['architecture']))?.architecture }
  } catch {
    return facts
  }
}

export const canRunHelper = (system: AddThisSystem) => system.os === 'macos' || system.os === 'linux'

/** "Mac" or "computer": how the dialog speaks of the machine. */
export const machineWord = (system: AddThisSystem) => (system.os === 'macos' ? 'Mac' : 'computer')

export const defaultName = (system: AddThisSystem) => (system.os === 'macos' ? 'Mac' : 'Linux computer')

/** Which build the Download button gives, before anything is minted. Mac downloads are universal. */
export function buildLabel({ os, arch }: AddThisSystem): string {
  if (os === 'macos') return arch === 'arm64' ? 'For Apple silicon Macs' : arch === 'x64' ? 'For Intel Macs' : 'For Macs'
  return arch === 'arm64' ? 'For Linux on ARM' : arch === 'x64' ? 'For Linux on x86-64' : 'For Linux'
}

/** Which file to open and how, from the file the server offered: "Open <file> from your downloads, ...". */
export const installerSteps = (download: HelperDownload) =>
  download.os === 'macos'
    ? { verb: 'Open', file: download.fileName, rest: 'from your downloads, then open LilBot Helper.' }
    : { verb: 'Unpack', file: download.fileName, rest: 'and run ./lilbot-helper in a terminal.' }
