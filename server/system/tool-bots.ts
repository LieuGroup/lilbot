/** Bot tools: list and read bots, create and edit them, choose the primary bot. Each calls the service function
 *  the screen of the same name uses (`bots.list`, `bots.get`, `bots.update`, `bots.setPrimary`, `models.list`). */
import { z } from 'zod'
import { BotUpdateInput } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/protocol'
import { BotCreationInput } from '../bots/bot-creation'
import { memoryRefusal } from '../memory/memory-safety'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

/** `botId` names another bot; left out it means the calling bot. */
const target = { botId: z.string().min(1).optional() }
const model = (bot: { model: { provider: string; model: string } | null }) => (bot.model ? `${bot.model.provider}/${bot.model.model}` : null)
const EditInput = BotUpdateInput.pick({ name: true, function: true, instructions: true, model: true, reasoningEffort: true }).extend(target)

export function botTools({ bots, activity }: SystemDeps): McpTool[] {
  return [
    readTool('lilbot_bots_list', 'Every bot with its roster state (primary, pinned and pinnedAt, hidden, section, unread), and the sections.', z.object({}), async () => ({
      bots: (await bots.listBots()).map(({ id, name, function: fn, isPrimary, prefs: { avatar, ...prefs }, ...bot }) => ({
        id,
        name,
        function: fn,
        model: model(bot),
        reasoningEffort: bot.reasoningEffort,
        primary: isPrimary,
        ...prefs,
        unread: activity.state(id).unread
      })),
      sections: bots.listSections()
    })),
    readTool('lilbot_bot_read', "A bot's setup: instructions, model, reasoning effort and abilities. Defaults to you.", z.object(target), async (caller, { botId }) => {
      const bot = await bots.getBot(botId ?? caller)
      return {
        id: bot.id,
        name: bot.name,
        function: bot.function,
        model: model(bot),
        reasoningEffort: bot.reasoningEffort,
        effectiveReasoningEffort: bot.effectiveReasoningEffort,
        primary: bot.isPrimary,
        instructions: bot.instructions,
        memoryConnected: bot.memoryConnected,
        abilities: bot.abilities.filter(ability => ability.enabled).map(ability => `${ability.kind}:${ability.id}`)
      }
    }),
    actionTool(
      'lilbot_bot_create',
      'Create a bot. Write its name, function (one line) and instructions. It inherits your model and greets Oscar. Reuse requestId when retrying one request, use a new one for each new bot. Reply with the link.',
      BotCreationInput,
      (caller, input) => bots.createFromBot(caller, input)
    ),
    actionTool(
      'lilbot_bot_edit',
      "Change a bot's name, function, instructions, model or reasoning effort (yours by default). Only the fields you give change. Effort is none, minimal, low, medium, high, xhigh or max; null goes back to the default.",
      EditInput,
      async (caller, { botId, ...patch }) => {
        if (!Object.keys(patch).length) throw new LilBotError('nothing_to_change', 'Give at least one of name, function, instructions, model, reasoningEffort.')
        const refusal = memoryRefusal([patch.name, patch.function, patch.instructions].filter(Boolean).join('\n'))
        if (refusal) throw new LilBotError('invalid_instructions', refusal)
        const bot = await bots.updateBot({ botId: botId ?? caller, ...patch })
        return { id: bot.id, name: bot.name, function: bot.function, model: model(bot), reasoningEffort: bot.reasoningEffort }
      }
    ),
    actionTool('lilbot_primary_set', "Make a bot the user's primary bot (listed first, opened on entry).", z.object({ botId: z.string().min(1) }), (_caller, { botId }) =>
      bots.setPrimary(botId)
    ),
    readTool('lilbot_models_list', 'The models a bot can use, by provider. Use provider and model exactly as listed when editing a bot.', z.object({}), async () =>
      bots.listModels()
    )
  ]
}
