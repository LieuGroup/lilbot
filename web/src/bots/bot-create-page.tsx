import { useNavigate } from '@tanstack/react-router'

import { lebot } from '../lebot-socket'
import { PageHeader } from '../ui/page-header'
import { BotForm } from './bot-form'
import { useBotStore } from './bot-store'

export function BotCreatePage() {
  const navigate = useNavigate()
  const upsert = useBotStore(state => state.upsert)

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="New bot" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6">
          <BotForm
            initial={{ name: '', function: '', instructions: '', model: null }}
            submitLabel="Create bot"
            noModelLabel="Same as the main bot"
            onSubmit={async values => {
              const bot = await lebot.call('bots.create', {
                name: values.name,
                function: values.function,
                instructions: values.instructions,
                ...(values.model ? { model: values.model } : {})
              })
              upsert(bot)
              await navigate({ to: '/bots/$botId', params: { botId: bot.id } })
            }}
          />
        </div>
      </div>
    </div>
  )
}
