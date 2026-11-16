/** Hermes profile <-> LeBot Bot. A bot is one Hermes profile; LeBot's display name lives in the
 *  profile's `ui_meta.lebot`, a namespace Hermes keeps for clients. */
import type { Bot, BotDetail, ModelProvider } from '../../../shared/bot-schema'

export const DEFAULT_PROFILE = 'default'
export const UI_NAMESPACE = 'lebot'

const text = (value: unknown) => (typeof value === 'string' ? value : '')

function displayName(profile: Record<string, any>): string {
  return text(profile.ui_meta?.[UI_NAMESPACE]?.name) || text(profile.display_name) || text(profile.ui_meta?.['hermes-bots']?.title) || text(profile.name)
}

export function botFromProfile(profile: Record<string, any>): Bot {
  return {
    id: text(profile.name),
    name: displayName(profile),
    function: text(profile.description),
    model: profile.model ? { provider: text(profile.provider), model: text(profile.model) } : null,
    isDefault: profile.is_default === true,
    skillCount: typeof profile.skill_count === 'number' ? profile.skill_count : 0
  }
}

/** `summary` is the bot's row from `profiles.list`; `described` is `profiles.describe`. */
export function botDetailFromProfile(summary: Bot, described: Record<string, any>): BotDetail {
  const skills: any[] = Array.isArray(described.skills) ? described.skills : []
  const toolsets: any[] = Array.isArray(described.toolsets) ? described.toolsets : []
  const model = described.model?.default ? { provider: text(described.model.provider), model: text(described.model.default) } : summary.model
  return {
    ...summary,
    function: text(described.description) || summary.function,
    model,
    instructions: text(described.soul),
    toolsets: toolsets.map(toolset => ({ name: text(toolset.name), label: text(toolset.label) || text(toolset.name), enabled: toolset.enabled === true })),
    skillCount: skills.length,
    enabledSkillCount: skills.filter(skill => skill.enabled === true).length,
    mcpServerCount: Array.isArray(described.mcp_servers) ? described.mcp_servers.length : 0
  }
}

/** Hermes profile ids are lowercase letters, digits and dashes. Made from the bot's name, kept unique. */
export function profileIdFor(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'bot'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
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
