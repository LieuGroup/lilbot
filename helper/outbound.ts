/** Control frames wait for buffer space; durable results retry without waiting for a heartbeat. */
export function outbound(emit: (frame: unknown) => boolean, results: () => { id: string; result: () => string }[], ready = () => true) {
  const controls = new Map<string, unknown>()
  const sentAt = new Map<string, number>()
  return {
    reset() {
      controls.clear()
      sentAt.clear()
    },
    acknowledge(id: string) {
      sentAt.delete(id)
    },
    receipt(id: string, result: string) {
      controls.set(`receipt:${id}`, { type: 'result', id, result: JSON.parse(result), final: true })
    },
    heartbeat(challenge = '') {
      controls.set(challenge, { type: 'heartbeat', ...(challenge ? { challenge } : {}) })
    },
    flush(now = Date.now()) {
      for (const [key, frame] of controls) {
        if (!emit(frame)) return
        controls.delete(key)
      }
      if (!ready()) return
      for (const row of results()) {
        if (now - (sentAt.get(row.id) ?? -Infinity) < 4000) continue
        if (!emit({ type: 'result', id: row.id, result: JSON.parse(row.result()), final: true })) return
        sentAt.set(row.id, now)
        return
      }
    }
  }
}
