/** The browser's connection to the LilBot server: the shared client over this origin's `/ws`. */
import { LilBotSocket, messageOf } from '../../../shared/client/socket'

const socketUrl = () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`

export const lilbot = new LilBotSocket({ url: socketUrl })

export { messageOf }
