/** Legacy identity import and runtime capabilities from Hermes profiles. */
import type { Ability, BotIdentity, ModelProvider } from '../../../shared/bot-schema'
import type { EngineBotDetail } from '../bot-engine'

export const DEFAULT_PROFILE = 'default'
const UI_NAMESPACE = 'lilbot'

const text = (value: unknown) => (typeof value === 'string' ? value : '')

function displayName(profile: Record<string, any>): string {
  return text(profile.ui_meta?.[UI_NAMESPACE]?.name) || text(profile.display_name) || text(profile.ui_meta?.['hermes-bots']?.title) || text(profile.name)
}

export function botFromProfile(profile: Record<string, any>): BotIdentity {
  return {
    id: text(profile.name),
    name: displayName(profile),
    function: text(profile.description),
    model: profile.model ? { provider: text(profile.provider), model: text(profile.model) } : null,
    permissionMode: 'full-access',
    isDefault: profile.is_default === true
  }
}

const abilitiesOf = (kind: Ability['kind'], rows: unknown): Ability[] =>
  (Array.isArray(rows) ? rows : [])
    .filter(row => row && typeof row === 'object' && text(row.name))
    .map(row => ({ kind, id: text(row.name), label: text(row.label) || text(row.name), enabled: row.enabled !== false }))

/** `summary` is the bot's row from `profiles.list`; `described` is `profiles.describe`. Hermes'
 *  skills, toolsets and MCP servers become one neutral list of abilities. */
export function botDetailFromProfile(summary: BotIdentity, described: Record<string, any>): Omit<EngineBotDetail, 'memoryConnected'> {
  const model = described.model?.default ? { provider: text(described.model.provider), model: text(described.model.default) } : summary.model
  return {
    ...summary,
    function: text(described.description) || summary.function,
    model,
    instructions: text(described.soul),
    abilities: [...abilitiesOf('toolset', described.toolsets), ...abilitiesOf('skill', described.skills), ...abilitiesOf('connector', described.mcp_servers)]
  }
}

/** Only providers the user is signed in to: the ones a bot can actually run on. */
export function providersFromModelOptions(result: Record<string, any>): ModelProvider[] {
  const providers: any[] = Array.isArray(result.providers) ? result.providers : []
  return providers
    .filter(provider => provider.authenticated === true && Array.isArray(provider.models) && provider.models.length > 0)
    .map(provider => ({
      provider: text(provider.slug),
      name: text(provider.name) || text(provider.slug),
      models: provider.models.filter((model: unknown) => typeof model === 'string')
    }))
}
