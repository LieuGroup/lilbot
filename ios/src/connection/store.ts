/** The server settings this install uses, plus the live connection state. The Access token
 *  lives in the Keychain (expo-secure-store); only the server address is plain storage. */
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { createConnectionStore, type ServerSettings } from './store-core'

export type { ServerSettings }

export const useConnectionStore = createConnectionStore({
  plain: {
    getItem: key => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value)
  },
  secret: {
    getItem: key => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    deleteItem: key => SecureStore.deleteItemAsync(key)
  }
})
