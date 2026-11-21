/** The MCP servers LilBot supplies to every bot, the same for every engine: T3 Code through LilBot's bridge, LilBot's
 *  own system server, and the services bots add (`server/connections/`). Each is an address on LilBot's loopback with
 *  a LilBot credential for this bot only; a service's own token never reaches the engine. */
export interface McpConnection {
  /** Every name starts with `lilbot_`: an engine owns those servers and leaves every other one alone. */
  name: string
  url: string
  bearerToken: string
  /** Seconds one tool call may take. */
  timeoutSeconds: number
  /** The tools the engine should offer; LilBot's route enforces the same list. */
  tools: readonly string[]
  /** A service a bot added: when it does not connect, the bot still works without it. */
  optional?: boolean
}

/** What applying the bot's connections did to one open conversation: changed from its next message, nothing to change,
 *  its turn is running (apply again once it ends), or the engine holds no live conversation by that id (a later resume
 *  reads the connections anyway). */
export type ConnectionsApplied = 'applied' | 'unchanged' | 'busy' | 'not_open'
