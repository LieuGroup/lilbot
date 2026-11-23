import { botCapability } from '../server/bots/bot-capability'
import { connectionKey } from '../server/connections/connection-keys'
import { SYSTEM_KEY_PURPOSE, SYSTEM_PATH } from '../server/system/system-connection'

interface SafetyCheckParams {
  port: number
  token: string
  botId: string
  computerId: string
}

async function callSystemMcp(port: number, token: string, botId: string, name: string, args: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${port}${SYSTEM_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${connectionKey(token, SYSTEM_KEY_PURPOSE, botId)}`,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(35_000)
  })
  const body = (await response.json()) as { result?: { isError?: boolean; content?: { text?: string }[] } }
  return { status: response.status, isError: Boolean(body.result?.isError), text: body.result?.content?.[0]?.text ?? '' }
}

/** Verifies both `/engine/computers/submit` and System MCP `lilbot_computer_exec` enforce the same LilBot safety stop, and ordinary MCP exec succeeds. */
export async function checkSafetyStops({ port, token, botId, computerId }: SafetyCheckParams) {
  const destructive = 'if false; then mkfs; fi'
  const refusedDirect = await fetch(`http://127.0.0.1:${port}/engine/computers/submit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-lilbot-bot-capability': botCapability(token, botId),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ computer: computerId, requestId: 'direct-hard-stop', background: true, operation: { kind: 'exec', command: destructive } })
  })
  const refusedBody = (await refusedDirect.json()) as { error?: string }
  if (refusedDirect.status !== 422 || !refusedBody.error?.includes('LilBot safety stop')) {
    throw new Error(`Direct submit did not enforce LilBot safety stop: ${refusedDirect.status} ${JSON.stringify(refusedBody)}`)
  }
  const refusedMcp = await callSystemMcp(port, token, botId, 'lilbot_computer_exec', {
    computer: computerId,
    requestId: 'mcp-hard-stop',
    background: true,
    command: destructive
  })
  if (refusedMcp.status !== 200 || !refusedMcp.isError || refusedMcp.text !== refusedBody.error) {
    throw new Error(`MCP lilbot_computer_exec safety stop mismatch: ${JSON.stringify(refusedMcp)} vs ${JSON.stringify(refusedBody)}`)
  }
  const okMcp = await callSystemMcp(port, token, botId, 'lilbot_computer_exec', {
    computer: computerId,
    requestId: 'mcp-ordinary-exec',
    command: 'printf MCP_EXEC_OK'
  })
  const okData = okMcp.isError ? undefined : (JSON.parse(okMcp.text) as { status?: string; result?: { output?: string } })
  if (okMcp.status !== 200 || okMcp.isError || okData?.status !== 'completed' || okData?.result?.output !== 'MCP_EXEC_OK') {
    throw new Error(`MCP ordinary lilbot_computer_exec failed: ${JSON.stringify(okMcp)}`)
  }
  console.log('PASS: LilBot safety stop refused destructive direct + MCP submissions identically; ordinary MCP exec succeeded')
}
