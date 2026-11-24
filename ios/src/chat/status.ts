/** Resolves the one-line conversation status shown inside the chat after the newest message,
 *  matching the web app's wording for every state (working/thinking/tool, reconnecting, opening). */

export interface ChatStatusLine {
  text: string
  tone: 'running' | 'muted'
}

export function resolveChatStatusLine(input: {
  connected: boolean
  ready: boolean
  running: boolean
  activity: string
}): ChatStatusLine | null {
  if (!input.connected) return { text: 'Reconnecting...', tone: 'muted' }
  if (!input.ready) return { text: 'Opening chat...', tone: 'muted' }
  const activity = input.activity.trim()
  if (input.running && activity) return { text: activity, tone: 'running' }
  return null
}
