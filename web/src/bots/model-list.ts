/** The engine's models, fetched once per connection and shared by the composer's pill and the bot form. */
import { useEffect } from 'react'
import { create } from 'zustand'

import type { ModelProvider } from '../../../shared/bot-schema'
import { lilbot } from '../app/lilbot-socket'
import { useBotStore } from './bot-store'

/** Null until the list has loaded once; a failed load keeps what was there. */
export const useModelList = create<{ providers: ModelProvider[] | null }>(() => ({ providers: null }))

let loading = false

function loadModels() {
  if (loading) return
  loading = true
  lilbot
    .call('models.list', {})
    .then(providers => useModelList.setState({ providers }))
    .catch(() => undefined)
    .finally(() => {
      loading = false
    })
}

/** The models, loaded when a part that shows them appears and again after every reconnect. */
export function useModelProviders() {
  const connected = useBotStore(state => state.connected)
  useEffect(() => {
    if (connected) loadModels()
  }, [connected])
  return useModelList(state => state.providers)
}
