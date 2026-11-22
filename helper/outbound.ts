/** Control frames wait for buffer space; durable results are sent once per connection on the ordered TCP stream. */
export function outbound(emit: (frame: unknown) => boolean, results: () => { id: string; result: () => string }[], ready = () => true) {
  const controls = new Map<string, unknown>()
  const sent = new Set<string>()
  return {
    reset() {
      controls.clear()
      sent.clear()
    },
    acknowledge(id: string) {
      sent.delete(id)
    },
    receipt(id: string, result: string) {
      controls.set(`receipt:${id}`, { type: 'result', id, result: JSON.parse(result), final: true })
    },
    heartbeat(challenge = '') {
      controls.set(challenge, { type: 'heartbeat', ...(challenge ? { challenge } : {}) })
    },
    control(key: string, frame: unknown) {
      controls.set(key, frame)
    },
    flush(_now = Date.now()) {
      for (const [key, frame] of controls) {
        if (!emit(frame)) return
        controls.delete(key)
      }
      if (!ready()) return
      for (const row of results()) {
        if (sent.has(row.id)) continue
        if (!emit({ type: 'result', id: row.id, result: JSON.parse(row.result()), final: true })) return
        sent.add(row.id)
        return
      }
    }
  }
}
