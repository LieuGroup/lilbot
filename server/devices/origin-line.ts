/** The one line LilBot adds, outside Oscar's text, to tell a bot where a turn came from. Names are untrusted display
 *  text, so they are JSON-quoted. Computer ids are included so the bot can call the computer tools without a lookup. */
export interface LinkedComputer {
  id: string
  name: string
  online: boolean
}

const quote = (text: string) => JSON.stringify(text)

export function deviceLine(deviceName: string, computer?: LinkedComputer): string {
  const where = computer ? `the computer ${quote(computer.name)} (id ${computer.id}, ${computer.online ? 'online' : 'offline'})` : 'not a connected computer'
  return `[LilBot origin: sent from the device ${quote(deviceName)}, which is ${where}.]`
}

export const unknownDeviceLine = '[LilBot origin: sent from a device LilBot does not recognise, which is not a connected computer.]'
export const routineLine = '[LilBot origin: a scheduled routine run, not a message from a device.]'
export const webhookLine = '[LilBot origin: a webhook event from an outside service, not a message from a device.]'
export const botLine = "[LilBot origin: another bot's message, not a message from a device.]"
export const boardLine = "[LilBot origin: Oscar's answer on the work board, not a message from a device.]"
