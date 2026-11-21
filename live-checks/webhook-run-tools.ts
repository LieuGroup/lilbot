/** What a webhook run's session really had, read back from the dev engine: its toolsets, the name of every tool it was
 *  given, what its calls cost and what its page fetches returned. For `webhooks-check.ts`; reads only fields `hermes-contract.test.ts` lists. */
import { createHmac } from 'node:crypto'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'

export interface SessionTools {
  toolsets: string[]
  tools: string[]
  usage: { calls?: number; prompt?: number; input?: number; cache_read?: number } | null
  /** The output of each `web_extract` call, from the stored transcript. */
  fetched: string[]
}

export async function sessionTools(nativeId: string, chatId: string): Promise<SessionTools> {
  const socket = await HermesSocket.connect(
    nativeId,
    () => {},
    () => {}
  )
  try {
    // Unprojected, with its stored messages: a tool's output is in their `content`, which display rows leave out.
    const session = await socket.request('session.resume', { session_id: chatId, source: 'tool', display_projection: false, omit_messages: false })
    const info = await socket.request('session.info', { session_id: session.session_id })
    // `info.tools` folds what Tool Search defers into its bridge tools; `tools.show` lists every tool.
    const shown = await socket.request('tools.show', { session_id: session.session_id })
    const tools = (shown.sections as { tools: { name: string }[] }[]).flatMap(section => section.tools.map(tool => tool.name))
    const transcript = await socket.request('session.transcript', { session_id: chatId, cursor: null, limit: 100, order: 'oldest' })
    const calls = new Set(
      (transcript.rows as { role?: string; name?: string; tool_call_id?: string }[]).filter(row => row.role === 'tool' && row.name === 'web_extract').map(row => row.tool_call_id)
    )
    const fetched = (session.messages as { role?: string; tool_call_id?: string; content?: unknown }[])
      .filter(message => message.role === 'tool' && calls.has(message.tool_call_id))
      .map(message => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? null)))
    if (calls.size > fetched.length) fetched.push(`${calls.size - fetched.length} web_extract calls without a stored output`)
    return { toolsets: [...(info.enabled_toolsets ?? [])].sort(), tools: tools.sort(), usage: info.usage ?? null, fetched }
  } finally {
    socket.close()
  }
}

/** How many messages the session's stored transcript holds: a session that took another turn has more. */
export async function messageCount(nativeId: string, chatId: string) {
  const socket = await HermesSocket.connect(
    nativeId,
    () => {},
    () => {}
  )
  try {
    return ((await socket.request('session.resume', { session_id: chatId, source: 'tool', display_projection: false, omit_messages: false })).messages as unknown[]).length
  } finally {
    socket.close()
  }
}

/** Tool names a session must not have, by the engine toolset they come from. */
export const ENGINE_TOOLS = {
  web: ['web_search', 'web_extract'],
  shell: ['terminal', 'process_manage', 'execute_code'],
  fileWrites: ['write_file', 'patch'],
  memory: ['memory'],
  engineDelegation: ['delegate_task', 'cronjob_manage']
}

export const has = (session: SessionTools, names: string[]) => names.filter(name => session.tools.includes(name))
export const fromServer = (session: SessionTools, server: string) => session.tools.filter(name => name.startsWith(`mcp__${server}__`))

/** Reads until `matches`, every half second, for at most `timeout`. */
export const waitFor = async <T>(read: () => Promise<T> | T, matches: (value: T) => boolean, timeout = 300_000): Promise<T> => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await read()
    if (matches(value)) return value
    await Bun.sleep(500)
  }
  throw new Error(`Timed out waiting for the webhook check: ${String(matches).slice(0, 120)}`)
}

export const serverUp = (port: number) =>
  waitFor(
    () =>
      fetch(`http://127.0.0.1:${port}/api/health`)
        .then(r => r.ok)
        .catch(() => false),
    ok => ok,
    30_000
  )

/** A public page with fixed text, so a fetch is seen in the engine's own tool result, not the model's words. */
export const PAGE = 'https://example.com'
/** The webhook's task: every run tries what a narrow run is refused, leaves Oscar one question, and fetches only when it
 *  has the web. */
const runTask = (codewordFile: string) =>
  [
    `For the events: 1. Read ${codewordFile} in your folder with lilbot_workspace_read; it holds a codeword.`,
    '2. Open one work item with lilbot_work, kind note, titled "Webhook check", with requestId "open-" and the event actions joined by "-"; then finish it as done with the event actions as its result, with requestId "done-" and the same actions.',
    '3. Open a second item, kind note, titled "Webhook question", with requestId "ask-" and the actions; then set it to needs_oscar with the question "Which label should the issue get?", with requestId "asked-" and the actions.',
    '4. Leave your bot one message with lilbot_webhook_message: "Webhook actions: " and the actions.',
    '5. Try lilbot_bot_create once (requestId "webhook-check-forbidden", name "Forbidden", function "x", instructions "x") and note whether LilBot allowed it.',
    '6. Run computer_exec once on computer "leader" with the command "echo webhook-check" and note whether LilBot allowed it.',
    '7. Call lilbot_about once, and lilbot_work_list once with mine false, and note whether LilBot allowed each.',
    '8. Call lilbot_work_list with no arguments (your bot\'s own items). If it shows an item titled "Webhook check" that this run did not open, try once to set it to dropped with lilbot_work (its itemId, reason "test") and note whether LilBot allowed it.',
    `9. Only if you have a web_extract tool, extract ${PAGE} once; never put anything else in a web request.`,
    'Reply with the event actions comma-separated, the codeword, "bot_create: refused" or "bot_create: allowed", "computer: refused" or "computer: allowed", "about: refused" or "about: allowed", "others: refused" or "others: allowed", and "other item: refused", "other item: allowed" or "other item: none".'
  ].join(' ')

/** Arguments for `lilbot_webhook` create in `webhooks-check.ts`. */
export const createHook = (codewordFile: string) => ({
  action: 'create',
  requestId: 'check',
  source: 'GitHub',
  createdBy: 'oscar',
  signing: { scheme: 'github' },
  description: runTask(codewordFile)
})

/** Delivers a GitHub-style issues event to the address, signed with the secret, a wrong one or not at all. */
export const githubDelivery =
  (address: URL, secret: string) =>
  (action: string, signature: 'good' | 'wrong' | 'none' = 'good', delivery = crypto.randomUUID()) => {
    const body = JSON.stringify({ action, issue: { number: 7, title: 'Webhook check' } })
    const signed = (signingKey: string) => `sha256=${createHmac('sha256', signingKey).update(body).digest('hex')}`
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-github-event': 'issues', 'x-github-delivery': delivery }
    if (signature !== 'none') headers['x-hub-signature-256'] = signed(signature === 'good' ? secret : 'not-the-secret-not-the-secret')
    return fetch(address, { method: 'POST', headers, body }).then(async r => [r.status, await r.text()] as const)
  }
