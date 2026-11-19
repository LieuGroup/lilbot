import { LilBotError } from '../../../shared/protocol'
import { assertDevAttachment } from './hermes-environment'

/** Asks Hermes for one attach grant: the gateway WebSocket URL plus a single-use ticket (30 s life).
 *  This is the path Hermes documents for local clients: `hermes gateway attach --json`. */

export interface HermesGrant {
  url: string
  protocols: string[]
}

const HERMES_BIN = process.env.LILBOT_HERMES_BIN ?? 'hermes'

/** `profile` empty means the default Hermes profile. Never log the result: the ticket is a credential. */
export async function attachToHermes(profile: string): Promise<HermesGrant> {
  const args = [...(profile ? ['-p', profile] : []), 'gateway', 'attach', '--json']
  const child = Bun.spawn([HERMES_BIN, ...args], { env: process.env, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])

  if (exitCode !== 0) {
    console.error(`[hermes] gateway attach exited ${exitCode}: ${stderr.trim().slice(0, 300)}`)
    throw new LilBotError('engine_unavailable', 'Hermes is not reachable. Check that the Hermes gateway is running.')
  }

  let grant: { state?: string; url?: string; protocols?: string[]; reason_code?: string | null; endpoint?: { profile_id?: string; control_home?: string | null } }
  try {
    grant = JSON.parse(stdout)
  } catch {
    throw new LilBotError('engine_unavailable', 'Hermes gave an unexpected answer when connecting.')
  }

  if (grant.state !== 'ready' || !grant.url || !Array.isArray(grant.protocols)) {
    throw new LilBotError('engine_unavailable', `Hermes is not ready yet (${grant.state ?? 'unknown'}). Try again in a moment.`)
  }

  assertDevAttachment(grant, profile)
  return { url: grant.url, protocols: grant.protocols }
}
