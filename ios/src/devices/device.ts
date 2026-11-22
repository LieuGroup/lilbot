/** This install's device id: made on first use and kept on the device, so every message says
 *  where it came from. Mirrors the web app's `lilbot.deviceId`. */
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'

const KEY = 'lilbot.deviceId'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let id: string | undefined

/** A fresh message id, matching the web app's `newMessageId`. */
export const newMessageId = () => Crypto.randomUUID()

export async function thisDeviceId(): Promise<string> {
  if (id) return id
  try {
    const saved = await AsyncStorage.getItem(KEY)
    if (saved && UUID.test(saved)) id = saved
  } catch {}
  if (!id) {
    id = Crypto.randomUUID()
    try {
      await AsyncStorage.setItem(KEY, id)
    } catch {}
  }
  return id
}
