/** Hermes model/auth resolution, editor MCP config, tool prefix stripping, and error cleaning. */
import { cleanAgentText } from './worker-text'

const EDITOR_MCP_PREFIX = /^mcp__editor_[a-z0-9_]+_[0-9a-f]{8}__/i
const SYSTEM_MCP_PREFIX = /^mcp__lilbot_system__/i

export const stripEditorMcpPrefix = (name: string): string => name.replace(EDITOR_MCP_PREFIX, '').replace(SYSTEM_MCP_PREFIX, '')

export function buildEditorMcpServers(mcp?: { url: string; token: string }) {
  if (!mcp) return []
  return [{ type: 'http', name: 'lilbot_system', url: mcp.url, headers: [{ name: 'Authorization', value: `Bearer ${mcp.token}` }] }]
}

/** Redacts the ephemeral MCP token and strips local config file paths from Hermes error messages. */
export function cleanHermesError(raw: string, secret?: string): string {
  const withoutPaths = raw.replace(/\s*\(Advanced:[^)]*\)/gi, '').replace(/\/[^\s)'"]+\/\.env\b/g, '.env')
  return cleanAgentText(withoutPaths.trim(), 1000, secret)
}

interface HermesModelOptionProvider {
  slug: string
  authenticated?: boolean
  models?: string[]
}

export interface HermesModelOptions {
  providers?: HermesModelOptionProvider[]
  model?: string
  provider?: string
}

export type ResolvedHermesModel = { ok: true; model?: string; provider?: string; fallbackNote?: string } | { ok: false; error: string }

const providerMatches = (slug: string, want: string) => {
  const s = slug.toLowerCase()
  const w = want.toLowerCase()
  return s === w || s === `custom:${w}` || s.endsWith(`:${w}`)
}

function modelInProvider(p: HermesModelOptionProvider, want: string): string | null {
  const models = Array.isArray(p.models) ? p.models : []
  const exact = models.find(m => m === want)
  if (exact) return exact
  const slash = want.indexOf('/')
  if (slash > 0) {
    const prefix = want.slice(0, slash)
    const bare = want.slice(slash + 1)
    if (providerMatches(p.slug, prefix)) {
      const bareHit = models.find(m => m === bare)
      if (bareHit) return bareHit
    }
  }
  return null
}

/** Matches the requested bot model against the remote Hermes's authenticated providers. Fails fast when unsigned or
 *  unconfigured, and falls back to the remote Hermes's own configured default model (never a hardcoded default) if needed. */
export function resolveHermesModel(requestModel: string, requestProvider: string | undefined, options: HermesModelOptions): ResolvedHermesModel {
  const providers = (options.providers ?? []).filter(p => p && typeof p.slug === 'string' && p.authenticated === true)
  if (!providers.length) {
    return { ok: false, error: 'Hermes on this computer is not signed in to any model provider. Run "hermes model" on that computer to sign in and pick a model.' }
  }
  if (requestProvider) {
    const direct = providers.find(p => providerMatches(p.slug, requestProvider))
    if (direct) {
      const hit = modelInProvider(direct, requestModel)
      if (hit) return { ok: true, model: hit, provider: direct.slug }
      if (!direct.models?.length) return { ok: true, model: requestModel, provider: direct.slug }
    }
  }
  for (const p of providers) {
    const hit = modelInProvider(p, requestModel)
    if (hit) return { ok: true, model: hit, provider: p.slug }
  }
  const slash = requestModel.indexOf('/')
  if (slash > 0) {
    const prefix = requestModel.slice(0, slash)
    const openMatch = providers.find(p => providerMatches(p.slug, prefix) && !p.models?.length)
    if (openMatch) return { ok: true, model: requestModel.slice(slash + 1), provider: openMatch.slug }
  }
  const configuredModel = typeof options.model === 'string' ? options.model.trim() : ''
  if (configuredModel) {
    return {
      ok: true,
      fallbackNote: `Requested model "${requestModel}" is not available on this computer's Hermes; using its configured model "${configuredModel}".`
    }
  }
  return {
    ok: false,
    error: `Hermes on this computer has no default model configured and cannot run "${requestModel}". Run "hermes model" on that computer to pick a model.`
  }
}
