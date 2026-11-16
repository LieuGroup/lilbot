import { useEffect, useState } from 'react'
import { Button } from '@/ui/button'
import { Notice } from '@/ui/notice'
import { Panel } from '@/ui/panel'
import { Separator } from '@/ui/separator'
import type { Ability, BotDetail } from '../../../shared/bot-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { BotForm } from './bot-form'
import { useBotStore } from './bot-store'
import { EditAvatarDialog } from './edit-avatar-dialog'
import { PrimaryBotAction } from './primary-bot-action'

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
              <span className="font-normal text-muted-foreground">
                {enabled.length} of {ofKind.length} on
              </span>
            </dt>
            <dd className="mt-1 text-muted-foreground">
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
export function BotSetupPanel({ botId }: { botId: string }) {
  const connected = useBotStore(state => state.connected)
  const upsert = useBotStore(state => state.upsert)
  const [bot, setBot] = useState<BotDetail | null>(null)
  const [editingAvatar, setEditingAvatar] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!connected) return
    let cancelled = false
    setBot(null)
    setError('')
    lilbot
      .call('bots.get', { botId })
      .then(detail => !cancelled && setBot(detail))
      .catch(failure => !cancelled && setError(messageOf(failure)))
    return () => {
      cancelled = true
    }
  }, [botId, connected])

  return (
    <Panel>
      {error && <Notice tone="error">{error}</Notice>}
      {!bot && !error && <p className="text-muted-foreground">Loading...</p>}
      {bot && (
        <>
          <Button variant="outline" onClick={() => setEditingAvatar(true)}>
            Edit avatar
          </Button>
          <EditAvatarDialog
            open={editingAvatar}
            onOpenChange={setEditingAvatar}
            name={bot.name}
            avatar={bot.prefs.avatar}
            onSave={async ({ name, avatar }) => {
              if (name !== bot.name) await lilbot.call('bots.update', { botId, name })
              await lilbot.call('bots.setPrefs', { botId, avatar })
              const updated = await lilbot.call('bots.get', { botId })
              setBot(updated)
              upsert(updated)
            }}
          />
          <PrimaryBotAction botId={botId} />
          <BotForm
            key={bot.id}
            initial={{ name: bot.name, function: bot.function, instructions: bot.instructions, model: bot.model }}
            submitLabel="Save changes"
            onSubmit={async values => {
              const updated = await lilbot.call('bots.update', {
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
          <Separator />
          <section aria-labelledby="workspace" className="flex flex-col gap-1.5">
            <h3 id="workspace" className="font-semibold">
              Workspace
            </h3>
            <p className="text-sm text-muted-foreground">This bot's own folder. New sessions work here.</p>
            <code className="break-all rounded-lg bg-muted px-2.5 py-1.5 font-mono text-[13px]">{bot.workspace}</code>
          </section>
          <Separator />
          <section aria-labelledby="abilities" className="flex flex-col gap-3">
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
