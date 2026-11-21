/** Every request LilBot itself makes to a service a bot added: bounded in time and size, checked against SSRF before
 *  connecting, never following a redirect (a service could send LilBot, with a token, somewhere else). */
import { assertPublicAddress, isLoopbackHost } from './mcp-net'

const SIGN_IN_TIMEOUT_MS = 10_000
const CAP = 1 << 20

export class Unreachable extends Error {}

/** Answers a redirect as itself; a network failure, timeout or blocked non-public IP is `Unreachable`. */
export async function boundedFetch(url: URL | string, init: RequestInit, timeoutMs = SIGN_IN_TIMEOUT_MS, allowLoopback?: boolean): Promise<Response> {
  const target = url instanceof URL ? url : new URL(url)
  try {
    await assertPublicAddress(target, allowLoopback ?? isLoopbackHost(target.hostname))
    return await fetch(target, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    throw new Unreachable('unreachable')
  }
}

/** The body as text, refused past `cap` bytes. */
export async function cappedText(response: Response, cap = CAP): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > cap) {
      await reader.cancel()
      throw new Unreachable('too large')
    }
    parts.push(value)
  }
  return Buffer.concat(parts).toString('utf8')
}

/** A JSON object body, or null. */
export async function jsonBody(response: Response): Promise<Record<string, any> | null> {
  try {
    const value = JSON.parse(await cappedText(response))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** The exact media-type prefix of a Content-Type header (lowercased, without parameters). */
export const mediaTypeOf = (contentType: string) => (contentType.split(';', 1)[0] ?? '').trim().toLowerCase()

/** Extracts each SSE event's `data` payload, treating `\r\n`, `\n` and bare `\r` as line ends per the SSE spec. */
export function parseSseData(body: string): string[] {
  const events: string[] = []
  let data: string[] = []
  const flush = () => {
    if (data.length) events.push(data.join('\n'))
    data = []
  }
  for (const line of body.replace(/\r\n|\r/g, '\n').split('\n')) {
    if (line === '') {
      flush()
    } else if (line.startsWith('data:')) {
      const rest = line.slice(5)
      data.push(rest.startsWith(' ') ? rest.slice(1) : rest)
    }
  }
  flush()
  return events
}

/** The JSON-RPC messages of a Streamable HTTP answer: one JSON body, or the `data:` of each server-sent event. */
export function rpcMessages(body: string, contentType: string): any[] {
  const parse = (text: string) => {
    try {
      const value = JSON.parse(text)
      return Array.isArray(value) ? value : [value]
    } catch {
      return []
    }
  }
  const type = mediaTypeOf(contentType)
  if (type === 'text/event-stream') return parseSseData(body).flatMap(parse)
  if (type === 'application/json') return parse(body)
  return []
}
