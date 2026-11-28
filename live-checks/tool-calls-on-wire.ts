/** Reads tool calls off the wire for the live check guard (`outside-access-guard.ts`): in request history, and in a
 *  model's answer, streamed or not, in any of the three wire formats. */

export interface ToolCall {
  name: string
  args: Record<string, unknown>
}

export function argsOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : { command: raw }
  } catch {
    return { command: raw }
  }
}

/** Every complete tool call in any of the three wire formats, at any depth of `value`. */
export function toolCallsIn(value: unknown, out: ToolCall[] = []): ToolCall[] {
  if (Array.isArray(value)) {
    for (const v of value) toolCallsIn(v, out)
    return out
  }
  if (!value || typeof value !== 'object') return out
  const o = value as Record<string, any>
  if (o.type === 'tool_use' && typeof o.name === 'string') out.push({ name: o.name, args: argsOf(o.input) })
  else if (o.type === 'function_call' && typeof o.name === 'string') out.push({ name: o.name, args: argsOf(o.arguments) })
  else if (o.function && typeof o.function.name === 'string') out.push({ name: o.function.name, args: argsOf(o.function.arguments) })
  for (const v of Object.values(o)) if (v && typeof v === 'object') toolCallsIn(v, out)
  return out
}

export const toolCallsInRequest = (body: unknown) => toolCallsIn([(body as any)?.messages, (body as any)?.input])

/** Every tool call in a model's answer, streamed (server-sent events, rebuilt from their pieces) or not. An answer
 *  that mentions a tool call none of this could read counts as one unnamed call, so it is refused rather than passed. */
export function toolCallsInResponse(text: string): ToolCall[] {
  const out: ToolCall[] = []
  if (text.trimStart().startsWith('{')) toolCallsIn(argsOf(text), out)
  const blocks = new Map<string, { name: string; json: string; input?: unknown }>()
  for (const line of text.trimStart().startsWith('{') ? [] : text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const event = argsOf(line.slice(5).trim()) as Record<string, any>
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use')
      blocks.set(`a${event.index}`, { name: String(event.content_block.name), json: '', input: event.content_block.input })
    else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const block = blocks.get(`a${event.index}`)
      if (block) block.json += event.delta.partial_json ?? ''
    } else if (event.type === 'response.output_item.done' || event.type === 'response.completed') toolCallsIn(event, out)
    for (const call of event.choices?.[0]?.delta?.tool_calls ?? []) {
      const block = blocks.get(`o${call.index ?? 0}`) ?? { name: '', json: '' }
      block.name ||= call.function?.name ?? ''
      block.json += call.function?.arguments ?? ''
      blocks.set(`o${call.index ?? 0}`, block)
    }
  }
  for (const block of blocks.values()) out.push({ name: block.name, args: block.json ? argsOf(block.json) : argsOf(block.input) })
  if (!out.length && /"type"\s*:\s*"(?:tool_use|function_call)"|"tool_calls"\s*:\s*\[\s*\{/.test(text)) out.push({ name: '', args: {} })
  return out
}
