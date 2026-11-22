/** Pure JSON rewrite helpers for bot re-keying. Never logs or inspects message or memory text. */

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const attachmentPrefix = (botId: string) => `/api/attachments/${encodeURIComponent(botId)}/`

function replaceAttachmentUrl(record: Obj, field: string, oldId: string, newId: string): boolean {
  const value = record[field]
  const prefix = attachmentPrefix(oldId)
  if (typeof value !== 'string' || !value.startsWith(prefix)) return false
  record[field] = `${attachmentPrefix(newId)}${value.slice(prefix.length)}`
  return true
}

function rewriteAttachmentsArray(list: unknown, oldId: string, newId: string): boolean {
  if (!Array.isArray(list)) return false
  let changed = false
  for (const item of list) {
    if (!isObj(item)) continue
    if (replaceAttachmentUrl(item, 'url', oldId, newId)) changed = true
    if (replaceAttachmentUrl(item, 'uploadUrl', oldId, newId)) changed = true
  }
  return changed
}

function rewriteChatItemObject(item: Obj, oldId: string, newId: string, workItemIds: ReadonlyMap<string, string>): boolean {
  let changed = false
  if (item.kind === 'connection.sign_in' && isObj(item.card) && item.card.botId === oldId) {
    item.card.botId = newId
    changed = true
  }
  if (item.kind === 'user' && rewriteAttachmentsArray(item.attachments, oldId, newId)) changed = true
  if (item.kind === 'tool' && typeof item.workItemId === 'string') {
    const mapped = workItemIds.get(item.workItemId)
    if (mapped) {
      item.workItemId = mapped
      changed = true
    }
  }
  return changed
}

export function rewriteStoredAttachment(raw: string, oldId: string, newId: string): string | null {
  const data = JSON.parse(raw) as Obj
  let changed = false
  if (data.botId === oldId) {
    data.botId = newId
    changed = true
  }
  if (replaceAttachmentUrl(data, 'url', oldId, newId)) changed = true
  if (replaceAttachmentUrl(data, 'uploadUrl', oldId, newId)) changed = true
  return changed ? JSON.stringify(data) : null
}

export function rewriteAttachmentMessage(raw: string, oldId: string, newId: string): string | null {
  const data = JSON.parse(raw) as Obj
  return rewriteAttachmentsArray(data.attachments, oldId, newId) ? JSON.stringify(data) : null
}

function rewriteMessageId(id: string, threadId: string, oldId: string, newId: string, deliveryIds: ReadonlyMap<string, string>): string | null {
  const direct = deliveryIds.get(id)
  if (direct) return direct
  if (id.endsWith(':reply')) {
    const base = id.slice(0, -':reply'.length)
    const mapped = deliveryIds.get(base)
    if (mapped) return `${mapped}:reply`
    if (base.startsWith(`${oldId}:`)) return `${newId}${base.slice(oldId.length)}:reply`
    if (base.startsWith(`group:${threadId}:`) && base.endsWith(`:${oldId}`)) return `${base.slice(0, -oldId.length)}${newId}:reply`
  }
  return id.startsWith(`${oldId}:`) ? `${newId}${id.slice(oldId.length)}` : null
}

function rewriteGroup(group: Obj, oldId: string, newId: string): boolean {
  let changed = false
  if (Array.isArray(group.rounds)) {
    for (const round of group.rounds) {
      if (!isObj(round)) continue
      for (const key of ['to', 'replied']) {
        const list = round[key]
        if (!Array.isArray(list)) continue
        for (let i = 0; i < list.length; i++) {
          if (list[i] === oldId) {
            list[i] = newId
            changed = true
          }
        }
      }
    }
  }
  if (isObj(group.seen) && Object.hasOwn(group.seen, oldId)) {
    group.seen[newId] = group.seen[oldId]
    delete group.seen[oldId]
    changed = true
  }
  for (const [listKey, idField] of [
    ['kept', 'fromId'],
    ['members', 'id']
  ] as const) {
    if (!Array.isArray(group[listKey])) continue
    for (const entry of group[listKey] as unknown[]) {
      if (isObj(entry) && entry[idField] === oldId) {
        entry[idField] = newId
        changed = true
      }
    }
  }
  return changed
}

export function rewriteThreadData(raw: string, oldId: string, newId: string, deliveryIds: ReadonlyMap<string, string>, workItemIds: ReadonlyMap<string, string>): string | null {
  const thread = JSON.parse(raw) as Obj
  const threadId = typeof thread.id === 'string' ? thread.id : ''
  let changed = false
  if (Array.isArray(thread.participants)) {
    for (const p of thread.participants) {
      if (isObj(p) && p.id === oldId) {
        p.id = newId
        changed = true
      }
    }
  }
  if (Array.isArray(thread.messages)) {
    for (const m of thread.messages) {
      if (!isObj(m)) continue
      if (m.authorId === oldId) {
        m.authorId = newId
        changed = true
      }
      if (typeof m.id === 'string') {
        const nextId = rewriteMessageId(m.id, threadId, oldId, newId, deliveryIds)
        if (nextId) {
          m.id = nextId
          changed = true
        }
      }
      if (Array.isArray(m.files)) {
        for (const f of m.files) {
          if (isObj(f) && f.fromId === oldId) {
            f.fromId = newId
            changed = true
          }
        }
      }
      if (Array.isArray(m.items)) {
        for (const item of m.items) if (isObj(item) && rewriteChatItemObject(item, oldId, newId, workItemIds)) changed = true
      }
    }
  }
  if (isObj(thread.stoppedBy) && thread.stoppedBy.kind === 'bot' && thread.stoppedBy.id === oldId) {
    thread.stoppedBy.id = newId
    changed = true
  }
  if (typeof thread.parentId === 'string' && workItemIds.has(thread.parentId)) {
    thread.parentId = workItemIds.get(thread.parentId)
    changed = true
  }
  if (isObj(thread.group) && rewriteGroup(thread.group, oldId, newId)) changed = true
  return changed ? JSON.stringify(thread) : null
}

export function rewriteChatItem(raw: string, oldId: string, newId: string, workItemIds: ReadonlyMap<string, string>): string | null {
  const item = JSON.parse(raw) as Obj
  return rewriteChatItemObject(item, oldId, newId, workItemIds) ? JSON.stringify(item) : null
}

export function rewriteHistoryEvent(raw: string, oldId: string, newId: string): string | null {
  const event = JSON.parse(raw) as Obj
  let changed = false
  if (event.type === 'connection.sign_in' && isObj(event.card) && event.card.botId === oldId) {
    event.card.botId = newId
    changed = true
  }
  if (event.type === 'user.message' && rewriteAttachmentsArray(event.attachments, oldId, newId)) changed = true
  return changed ? JSON.stringify(event) : null
}
