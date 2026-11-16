import { useParams } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import type { Ability, BotDetail } from '../../../shared/bot-schema'
import { lebot, messageOf } from '../lebot-socket'
import { Notice } from '../ui/controls'
import { Panel } from '../ui/panel'
import { BotForm } from './bot-form'
import { useBotStore } from './bot-store'

const kindLabels: Record<Ability['kind'], string> = { toolset: 'Toolsets', skill: 'Skills', connector: 'Connectors' }

/** One line per kind of ability: how many are on, and the names of the first few. */
function AbilitySummary({ abilities }: { abilities: Ability[] }) {
  return (
    <dl className="flex flex-col gap-3 text-sm">
      {(Object.keys(kindLabels) as Ability['kind'][]).map(kind => {
        const ofKind = abilities.filter(ability => ability.kind === kind)
        const enabled = ofKind.filter(ability => ability.enabled)
        if (ofKind.length === 0) return null
        return (
          <div key={kind}>
            <dt className="font-medium">
              {kindLabels[kind]}{' '}
              <span className="font-normal text-muted">
                {enabled.length} of {ofKind.length} on
              </span>
            </dt>
            <dd className="mt-1 text-muted">
              {enabled
                .slice(0, 8)
                .map(ability => ability.label)
                .join(', ')}
              {enabled.length > 8 && `, and ${enabled.length - 8} more`}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/** The Setup panel beside the chat: what the bot is, how it behaves, and what it can use. */
export function BotSetupPanel() {
  const { botId } = useParams({ from: '/bots/$botId/setup' })
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

  return (
    <Panel title="Setup" botId={botId}>
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
          <section aria-labelledby="workspace" className="flex flex-col gap-1.5 border-t border-border pt-6">
            <h3 id="workspace" className="font-semibold">
              Workspace
            </h3>
            <p className="text-sm text-muted">This bot's own folder. New sessions work here.</p>
            <code className="break-all rounded-lg bg-bg px-2.5 py-1.5 font-mono text-[13px]">{bot.workspace}</code>
          </section>
          <section aria-labelledby="abilities" className="flex flex-col gap-3 border-t border-border pt-6">
            <h3 id="abilities" className="font-semibold">
              Abilities
            </h3>
            <AbilitySummary abilities={bot.abilities} />
          </section>
        </>
      )}
    </Panel>
  )
}
