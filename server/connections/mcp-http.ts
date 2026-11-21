/** Every request LilBot itself makes to a service a bot added: bounded in time and size, never following a redirect (a
 *  service could send LilBot, with a token, somewhere else). Bodies are read as text only up to a cap. */

const SIGN_IN_TIMEOUT_MS = 10_000
const CAP = 1 << 20

export class Unreachable extends Error {}

/** Answers a redirect as itself; a network failure or a timeout is `Unreachable`. */
export async function boundedFetch(url: URL | string, init: RequestInit, timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
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

/** The JSON-RPC messages of a Streamable HTTP answer: one JSON body, or the `data:` of each server-sent event. */
export function rpcMessages(body: string, contentType: string): any[] {
  const parse = (text: string) => {
    try {
      return [JSON.parse(text)]
    } catch {
      return []
    }
  }
  if (!contentType.includes('text/event-stream')) return parse(body).flat()
  return body
    .split(/\r?\n\r?\n/)
    .map(event =>
      event
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
    )
    .filter(Boolean)
    .flatMap(parse)
}
