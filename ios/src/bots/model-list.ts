/** The engine's models, fetched once per connection and shared by the composer pill. Null until loaded. */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ModelProvider } from '../../../shared/bot-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'

interface ModelListState {
  providers: ModelProvider[] | null
  loaded: boolean
  error: string
  load: () => Promise<void>
}

export const useModelList = create<ModelListState>((set, get) => ({
  providers: null,
  loaded: false,
  error: '',
  load: async () => {
    if (get().loaded) return
    const socket = ensureSocket()
    if (!socket) return
    try {
      const providers = await socket.call('models.list', {})
      set({ providers, loaded: true, error: '' })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  }
}))

/** Load the models when the socket is connected; call again after a reconnect by remounting or by `connected` flipping. */
export function useModelProviders(connected: boolean) {
  useEffect(() => {
    if (connected) {
      useModelList.setState({ loaded: false })
      void useModelList.getState().load()
    }
  }, [connected])
  return useModelList(state => state.providers)
}
