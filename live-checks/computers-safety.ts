import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { botCapability } from '../server/bots/bot-capability'
import { connectionKey } from '../server/connections/connection-keys'
import { developmentHome } from '../server/environment'
import { SYSTEM_KEY_PURPOSE, SYSTEM_PATH } from '../server/system/system-connection'

interface SafetyCheckParams {
  port: number
  token: string
  botId: string
  nativeId: string
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

export async function mcpTool(port: number, token: string, botId: string, name: string, args: Record<string, unknown>) {
  const res = await callSystemMcp(port, token, botId, name, args)
  if (res.status !== 200 || res.isError) throw new Error(res.text || `MCP ${name} failed (${res.status})`)
  return JSON.parse(res.text) as any
}

/** Verifies retired `/engine/computers/*` answers 410, no legacy plugin/settings exist on the profile, and System MCP enforces the LilBot safety stop. */
export async function checkSafetyStops({ port, token, botId, nativeId, computerId }: SafetyCheckParams) {
  const profileDir = join(developmentHome, 'hermes', 'profiles', nativeId)
  if (existsSync(join(profileDir, 'plugins', 'lilbot-computers-v1')) || existsSync(join(profileDir, 'lilbot-computers.json'))) {
    throw new Error(`Legacy computers plug-in or settings file still present in ${profileDir}`)
  }
  const destructive = 'if false; then mkfs; fi'
  const retired = await fetch(`http://127.0.0.1:${port}/engine/computers/submit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-lilbot-bot-capability': botCapability(token, botId),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ computer: computerId, requestId: 'direct-hard-stop', background: true, operation: { kind: 'exec', command: destructive } })
  })
  const retiredBody = (await retired.json()) as { error?: string }
  if (retired.status !== 410 || !retiredBody.error?.includes('lilbot_computer_exec')) {
    throw new Error(`Retired /engine/computers/submit did not answer 410 with MCP guidance: ${retired.status} ${JSON.stringify(retiredBody)}`)
  }
  const refusedMcp = await callSystemMcp(port, token, botId, 'lilbot_computer_exec', {
    computer: computerId,
    requestId: 'mcp-hard-stop',
    background: true,
    command: destructive
  })
  if (refusedMcp.status !== 200 || !refusedMcp.isError || !refusedMcp.text.includes('LilBot safety stop')) {
    throw new Error(`MCP lilbot_computer_exec did not enforce LilBot safety stop: ${JSON.stringify(refusedMcp)}`)
  }
  const okMcp = await mcpTool(port, token, botId, 'lilbot_computer_exec', {
    computer: computerId,
    requestId: 'mcp-ordinary-exec',
    command: 'printf MCP_EXEC_OK'
  })
  if (okMcp.status !== 'completed' || okMcp.result?.output !== 'MCP_EXEC_OK') {
    throw new Error(`MCP ordinary lilbot_computer_exec failed: ${JSON.stringify(okMcp)}`)
  }
  console.log('PASS: legacy computers plug-in absent, /engine/computers/* returned 410, and System MCP safety stop + ordinary exec passed')
}
