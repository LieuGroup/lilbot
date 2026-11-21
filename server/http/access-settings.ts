/** Access is a separate, opt-in loopback listener. Never include setting values in errors. */
export interface AccessSettings {
  port: number
  host: string
  issuer: string
  audience: string
  email: string
  certsUrl: URL
  /** Opt-in: mount GET `/api/connections/callback` on the Access door. Off by default; paste fallback works without it. */
  callbackEnabled: boolean
}

export function accessSettings(env: Record<string, string | undefined>, privatePort: number, helperPort: number): AccessSettings | undefined {
  if (!env.LILBOT_ACCESS_ENABLED || env.LILBOT_ACCESS_ENABLED === '0') return
  if (env.LILBOT_ACCESS_ENABLED !== '1') throw new Error('LILBOT_ACCESS_ENABLED must be 0 or 1.')
  const rawCallback = env.LILBOT_ACCESS_CALLBACK_ENABLED
  if (rawCallback !== undefined && rawCallback !== '' && rawCallback !== '0' && rawCallback !== '1') {
    throw new Error('LILBOT_ACCESS_CALLBACK_ENABLED must be 0 or 1.')
  }
  const callbackEnabled = rawCallback === '1'
  const required = ['PORT', 'TEAM', 'AUD', 'EMAIL', 'HOST'] as const
  for (const name of required) if (!env[`LILBOT_ACCESS_${name}`]?.trim()) throw new Error(`LILBOT_ACCESS_${name} is required.`)
  const port = Number(env.LILBOT_ACCESS_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === privatePort || port === helperPort) throw new Error('Access needs a separate valid port.')
  const team = env.LILBOT_ACCESS_TEAM!.trim().toLowerCase()
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(team)) throw new Error('Access team must be a Cloudflare Access team domain.')
  const host = env.LILBOT_ACCESS_HOST!.trim().toLowerCase()
  if (host.length > 253 || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error('Access host must be a hostname.')
  const issuer = `https://${team}`
  let certsUrl = new URL(`${issuer}/cdn-cgi/access/certs`)
  // Only an isolated live check can substitute a local key server: `check:access` with no bots, or a development server whose
  // bots are all temporary `dev-` profiles (`check:connections`). No production URL override (it refuses `*_TEST_*` too).
  if (env.LILBOT_ACCESS_TEST_CERTS_URL) {
    certsUrl = new URL(env.LILBOT_ACCESS_TEST_CERTS_URL)
    const temporaryBots = env.LILBOT_ENV === 'development' && !!env.LILBOT_BOT_IDS?.split(',').every(id => /^dev-[a-z0-9-]+$/.test(id))
    if (
      !env.LILBOT_DATA_DIR ||
      !env.LILBOT_WORKSPACES_DIR ||
      !env.LILBOT_SKILLS_DIR ||
      (env.LILBOT_BOT_IDS !== 'isolation-access-check' && !temporaryBots) ||
      certsUrl.protocol !== 'http:' ||
      certsUrl.hostname !== '127.0.0.1' ||
      certsUrl.username ||
      certsUrl.password
    ) {
      throw new Error('Local Access keys require the isolated access check.')
    }
  }
  return { port, host, issuer, audience: env.LILBOT_ACCESS_AUD!.trim(), email: env.LILBOT_ACCESS_EMAIL!.trim().toLowerCase(), certsUrl, callbackEnabled }
}
