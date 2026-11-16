import { Link, useParams } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import type { BotDetail } from '../../../shared/bot-schema'
import { lebot, messageOf } from '../lebot-socket'
import { Notice } from '../ui/controls'
import { PageHeader } from '../ui/page-header'
import { BotForm } from './bot-form'
import { useBotStore } from './bot-store'

export function BotSettingsPage() {
  const { botId } = useParams({ from: '/bots/$botId/settings' })
  const connected = useBotStore(state => state.connected)
  const upsert = useBotStore(state => state.upsert)
  const [bot, setBot] = useState<BotDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!connected) return
    let cancelled = false
    setBot(null)
    setError('')
    lebot
      .call('bots.get', { botId })
      .then(detail => !cancelled && setBot(detail))
      .catch(failure => !cancelled && setError(messageOf(failure)))
    return () => {
      cancelled = true
    }
  }, [botId, connected])

  const enabledToolsets = bot?.toolsets.filter(toolset => toolset.enabled) ?? []

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={bot ? `${bot.name} settings` : 'Bot settings'}
        actions={
          <Link to="/bots/$botId" params={{ botId }} className="rounded-xl border border-border px-3 py-1.5 text-sm font-medium">
            Chat
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6">
          {error && <Notice tone="error">{error}</Notice>}
          {!bot && !error && <p className="text-muted">Loading...</p>}
          {bot && (
            <>
              <BotForm
                key={bot.id}
                initial={{ name: bot.name, function: bot.function, instructions: bot.instructions, model: bot.model }}
                submitLabel="Save changes"
                onSubmit={async values => {
                  const updated = await lebot.call('bots.update', {
                    botId,
                    name: values.name,
                    function: values.function,
                    instructions: values.instructions,
                    ...(values.model ? { model: values.model } : {})
                  })
                  setBot(updated)
                  upsert(updated)
                }}
              />
              <section aria-labelledby="abilities" className="flex flex-col gap-2 border-t border-border pt-6">
                <h2 id="abilities" className="font-semibold">
                  Abilities
                </h2>
                <p className="text-sm text-muted">
                  {bot.enabledSkillCount} of {bot.skillCount} skills on, {enabledToolsets.length} of {bot.toolsets.length} toolsets on, {bot.mcpServerCount} MCP{' '}
                  {bot.mcpServerCount === 1 ? 'server' : 'servers'}.
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {enabledToolsets.map(toolset => (
                    <li key={toolset.name} className="rounded-full border border-border px-2.5 py-1 text-sm">
                      {toolset.label}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
