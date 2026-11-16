import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { PageHeader } from '@/ui/page-header'
import { defaultAvatar } from '../../../shared/avatar'
import { lilbot } from '../app/lilbot-socket'
import { AvatarPicker } from './avatar-picker'
import { BotForm } from './bot-form'
import { useBotStore } from './bot-store'

export function BotCreatePage() {
  const [avatar, setAvatar] = useState(() => defaultAvatar(crypto.randomUUID()))
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
              const bot = await lilbot.call('bots.create', {
                avatar,
                name: values.name,
                function: values.function,
                instructions: values.instructions,
                ...(values.model ? { model: values.model } : {})
              })
              upsert(bot)
              await navigate({ to: '/bots/$botId', params: { botId: bot.id } })
            }}
          >
            <AvatarPicker value={avatar} onChange={setAvatar} />
          </BotForm>
        </div>
      </div>
    </div>
  )
}
