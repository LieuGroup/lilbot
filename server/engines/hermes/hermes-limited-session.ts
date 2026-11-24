/** Shared Hermes limited-session helper used by checks, webhooks, narrowed hand-offs/workers, and memory reviews.
 *  Runs on `source: 'acp'` with `'skills' + 'no_mcp'` + per-session `editor.mcp_servers`, verifies `tools/list`
 *  discovery AND audits both `session.info.enabled_toolsets` and `tools.show` against the scope's explicit allow-list
 *  before any prompt runs, and sets `edit_policy: 'workspace_session'` only when `shell` is granted (checks stay at
 *  default `'ask'`, which immediately denies `write_file`/`patch`). Never edits profile config or restarts the gateway. */
import type { BotModel, ReasoningEffort } from '../../../shared/bot-schema'
import { LilBotError } from '../../../shared/lilbot-error'
import type { RunAccessScope } from '../bot-engine'
import type { McpConnection } from '../mcp-connection'
import { allowedHermesBuiltins, hermesToolsetsForRun, limitedNeedsFileEdits } from './hermes-access'
import type { HermesSocket } from './hermes-socket'

const CLIENT = { name: 'lilbot', version: '0.2.0' }
const sanitize = (name: string) => name.replace(/[^A-Za-z0-9_]/g, '_')

export interface LimitedSessionCreateParams {
  requestId: string
  cwd: string
  access: RunAccessScope
  sessionMcp: McpConnection[]
  model?: BotModel
  reasoningEffort?: ReasoningEffort
  ignoreRules?: boolean
  assertSessionMcpReady?: () => void
}

/** Converts LilBot's neutral `McpConnection[]` into Hermes's `editor` policy payload (`edit_approval_policy` must be `'ask'` at create). */
function editorMcpSpec(connections: readonly McpConnection[]) {
  return {
    edit_approval_policy: 'ask' as const,
    mcp_servers: connections.map(conn => ({
      type: 'http' as const,
      name: conn.name,
      url: conn.url,
      headers: [{ name: 'Authorization', value: `Bearer ${conn.bearerToken}` }]
    }))
  }
}

type ToolShowSection = { name: string; tools: { name: string; description?: string }[] }
const LILBOT_SKILL_MANAGE_PREFIX = 'Create or improve a shared LilBot skill.'

/** Verifies the live session's actual toolsets (`session.info`) and tools (`tools.show`) match the scope's explicit
 *  allow-list: catches silent `partial=True` discovery drops, plugin toolsets, `x_search`, or leaked profile MCPs. */
async function verifyLimitedSession(socket: HermesSocket, sessionId: string, access: RunAccessScope, sessionMcp: readonly McpConnection[]) {
  const { toolsets: allowedBuiltins, tools: allowedBuiltinTools } = allowedHermesBuiltins(access)
  const expectedEditors = sessionMcp.map(conn => {
    const clean = sanitize(conn.name)
    return {
      conn,
      toolsetPattern: new RegExp(`^mcp-editor_${clean}_[0-9a-f]{8}$`),
      toolPattern: new RegExp(`^mcp__editor_${clean}_[0-9a-f]{8}__(.+)$`),
      allowedTools: conn.tools ? new Set(conn.tools) : null
    }
  })

  const [info, shown] = await Promise.all([socket.request('session.info', { session_id: sessionId }), socket.request('tools.show', { session_id: sessionId })])
  const enabled: unknown[] = Array.isArray(info?.enabled_toolsets) ? info.enabled_toolsets : []
  if (!enabled.length) throw new LilBotError('session_scope_violation', 'Limited session reported no enabled toolsets.')

  const matchedEditors = new Set<number>()
  for (const raw of enabled) {
    if (typeof raw !== 'string') throw new LilBotError('session_scope_violation', 'Limited session reported an invalid toolset.')
    if (allowedBuiltins.has(raw)) continue
    const idx = expectedEditors.findIndex(entry => entry.toolsetPattern.test(raw))
    if (idx < 0) throw new LilBotError('session_scope_violation', `Unexpected toolset "${raw}" attached to limited session.`)
    matchedEditors.add(idx)
  }
  if (matchedEditors.size < expectedEditors.length) {
    throw new LilBotError('session_mcp_unavailable', 'Limited session tool endpoint failed to attach.')
  }

  if (!shown || !Array.isArray(shown.sections)) {
    throw new LilBotError('session_scope_violation', 'Limited session returned malformed tools.show response.')
  }
  const sections: ToolShowSection[] = shown.sections
  // When a scope allows zero built-in tools (such as 'review' with ['context_engine', 'no_mcp']),
  // Hermes tools.show runs outside the per-session MCP scope and legitimately returns sections: []
  // while session.info.enabled_toolsets + assertSessionMcpReady verify the scoped MCP attachment.
  if (!sections.length && allowedBuiltinTools.size > 0) {
    throw new LilBotError('session_scope_violation', 'Limited session reported no tool sections.')
  }
  for (const section of sections) {
    const secName = typeof section?.name === 'string' ? section.name : ''
    const isBuiltin = allowedBuiltins.has(secName)
    const editorIdx = isBuiltin ? -1 : expectedEditors.findIndex(entry => entry.toolsetPattern.test(secName))
    if (!isBuiltin && editorIdx < 0) {
      throw new LilBotError('session_scope_violation', `Unexpected tool section "${secName}" attached to limited session.`)
    }
    const rows = Array.isArray(section?.tools) ? section.tools : []
    for (const row of rows) {
      const toolName = typeof row?.name === 'string' ? row.name : ''
      if (isBuiltin) {
        if (!allowedBuiltinTools.has(toolName)) {
          throw new LilBotError('session_scope_violation', `Unexpected built-in tool "${toolName}" attached to limited session.`)
        }
        if (toolName === 'skill_manage' && (typeof row?.description !== 'string' || !row.description.startsWith(LILBOT_SKILL_MANAGE_PREFIX))) {
          throw new LilBotError('session_scope_violation', 'Limited session exposed non-LilBot skill_manage tool.')
        }
        continue
      }
      const editor = expectedEditors[editorIdx]
      const match = editor.toolPattern.exec(toolName)
      if (!match || (editor.allowedTools && !editor.allowedTools.has(match[1]))) {
        throw new LilBotError('session_scope_violation', `Unexpected MCP tool "${toolName}" attached to limited session.`)
      }
    }
  }
}

/** Creates a hidden ACP session bound exclusively to `params.sessionMcp`, verifying discovery and tool allow-lists before returning. */
export async function createLimitedSession(socket: HermesSocket, params: LimitedSessionCreateParams) {
  if (!params.sessionMcp.length) throw new LilBotError('session_mcp_unavailable', 'Limited sessions require a session-bound MCP connection.')
  const toolsets = hermesToolsetsForRun(params.access)
  if (!toolsets?.includes('no_mcp')) throw new LilBotError('session_mcp_unavailable', 'Limited sessions require no_mcp toolset isolation.')
  const session = await socket.request('session.create', {
    source: 'acp',
    hidden: true,
    yolo: true,
    ...(params.ignoreRules ? { ignore_rules: true } : {}),
    request_id: params.requestId,
    client: CLIENT,
    cwd: params.cwd,
    cwd_explicit: true,
    toolsets,
    editor: editorMcpSpec(params.sessionMcp),
    ...(params.model ? { model: params.model.model, provider: params.model.provider } : {}),
    ...(params.reasoningEffort ? { reasoning: params.reasoningEffort } : {})
  })
  // Fail closed on Hermes's `rebind_editor_mcp(partial=True)` silent drop or any unexpected toolset/tool before prompt.submit.
  params.assertSessionMcpReady?.()
  if (typeof session.session_id !== 'string' || !session.session_id) {
    throw new LilBotError('session_mcp_unavailable', 'Limited session returned no session id.')
  }
  await verifyLimitedSession(socket, session.session_id, params.access, params.sessionMcp)
  if (limitedNeedsFileEdits(params.access)) {
    await socket.request('session.mutate', {
      session_id: session.session_id,
      request_id: `${params.requestId}:edit-policy`,
      expected_revision: session.revision,
      expected_generation: session.execution_generation,
      operation: 'edit_policy',
      payload: { policy: 'workspace_session' }
    })
  }
  return session
}

/** Immediately denies an edit-approval prompt on a limited ACP session (`ask` for checks, or out-of-workspace writes
 *  under `workspace_session`) so Hermes never blocks for the 300 s approval timeout. */
export function denyLimitedApproval(socket: HermesSocket, sessionId: string, payload: Record<string, any>, fallbackGen?: number) {
  const promptId = typeof payload?.prompt_id === 'string' ? payload.prompt_id : ''
  const gen = typeof payload?.execution_generation === 'number' ? payload.execution_generation : fallbackGen
  if (!promptId || typeof gen !== 'number') return
  void socket.request('approval.respond', { session_id: sessionId, execution_generation: gen, prompt_id: promptId, choice: 'deny' }).catch(() => {})
}

/** Resumes a hidden ACP limited session, re-supplying its deterministic `editor.mcp_servers` spec and auditing its
 *  tool surface so Hermes re-attaches the exact same policy across `acp_disconnect` or a gateway restart. */
export async function resumeLimitedSession(
  socket: HermesSocket,
  chatId: string,
  sessionMcp: readonly McpConnection[],
  access?: RunAccessScope,
  displayProjection = true,
  assertSessionMcpReady?: () => void
) {
  if (!sessionMcp.length) throw new LilBotError('session_mcp_unavailable', 'Limited sessions require a session-bound MCP connection.')
  const session = await socket.request('session.resume', {
    session_id: chatId,
    source: 'acp',
    display_projection: displayProjection,
    editor: editorMcpSpec(sessionMcp)
  })
  assertSessionMcpReady?.()
  if (access && typeof session.session_id === 'string' && session.session_id) {
    await verifyLimitedSession(socket, session.session_id, access, sessionMcp)
    if (Array.isArray(session.prompts)) {
      for (const prompt of session.prompts) if (prompt?.kind === 'approval') denyLimitedApproval(socket, session.session_id, prompt, session.execution_generation)
    }
  }
  return session
}
