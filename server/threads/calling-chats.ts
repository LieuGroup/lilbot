/** Which conversation of a bot made a call to LilBot's MCP server. MCP requests carry no session, so the engine reports
 *  every tool call it sees start (`BotEngine.onToolCall`) and the call is matched by its `requestId`. Hidden runs are
 *  reported by the socket that submitted them, almost at once; anything else is the bot's main conversation. */

const KEEP_MS = 120_000

/** Tool search can wrap the call: `tool_call({ name, arguments })`, with the arguments as an object or JSON text. */
function requestIdOf(tool: string, args: unknown): string | null {
  const record = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})
  let inner = record(args)
  if (!tool.endsWith('lilbot_delegate')) {
    if (typeof inner.name !== 'string' || !inner.name.endsWith('lilbot_delegate')) return null
    try {
      inner = record(typeof inner.arguments === 'string' ? JSON.parse(inner.arguments) : inner.arguments)
    } catch {
      return null
    }
  }
  return typeof inner.requestId === 'string' ? inner.requestId : null
}

export class CallingChats {
  private seen: { botId: string; chatId: string; requestId: string; at: number }[] = []
  constructor(
    private mainChat: (botId: string) => string | null,
    private waitMs = 3000
  ) {}

  saw(botId: string, chatId: string, tool: string, args: unknown) {
    const requestId = requestIdOf(tool, args)
    if (!requestId) return
    const now = Date.now()
    this.seen = [...this.seen.filter(s => now - s.at < KEEP_MS), { botId, chatId, requestId, at: now }]
  }

  async find(botId: string, requestId: string): Promise<string | null> {
    const end = Date.now() + this.waitMs
    for (;;) {
      const match = this.seen.filter(s => s.botId === botId && s.requestId === requestId).at(-1)
      if (match) return match.chatId
      if (Date.now() >= end) return this.mainChat(botId)
      await Bun.sleep(100)
    }
  }
}
