/** Recursive item tree nesting, status/bot grouping, and evidence partitioning for the Work board. Pure. */
import type { Evidence, WorkItem, WorkSummary } from '../../work-schema'

export interface TreeRow {
  item: WorkSummary
  children: TreeRow[]
}

/** Nests children recursively under their parent when present in `items`, preserving order and guarding against cycles. */
export function nestItems(items: WorkSummary[]): TreeRow[] {
  const byId = new Set(items.map(i => i.id))
  const children = new Map<string, WorkSummary[]>()
  for (const item of items) {
    if (item.parentId && item.parentId !== item.id && byId.has(item.parentId)) {
      const list = children.get(item.parentId) ?? []
      list.push(item)
      children.set(item.parentId, list)
    }
  }
  const placed = new Set<string>()
  const build = (item: WorkSummary, path: Set<string>): TreeRow => {
    placed.add(item.id)
    const nextPath = new Set(path)
    nextPath.add(item.id)
    const kids: TreeRow[] = []
    for (const child of children.get(item.id) ?? []) {
      if (!nextPath.has(child.id) && !placed.has(child.id)) kids.push(build(child, nextPath))
    }
    return { item, children: kids }
  }
  const roots: TreeRow[] = []
  for (const item of items) {
    if (!item.parentId || item.parentId === item.id || !byId.has(item.parentId)) roots.push(build(item, new Set()))
  }
  for (const item of items) {
    if (!placed.has(item.id)) roots.push(build(item, new Set()))
  }
  return roots
}

export function groupByStatus(items: WorkSummary[]) {
  const workingItems = items.filter(i => i.status === 'open' || i.status === 'working' || i.status === 'checking')
  return {
    needsOscar: items.filter(i => i.status === 'needs_oscar'),
    working: nestItems(workingItems),
    workingCount: workingItems.length,
    done: items.filter(i => i.status === 'done'),
    failed: items.filter(i => i.status === 'failed'),
    dropped: items.filter(i => i.status === 'dropped')
  }
}

export function groupByBot(items: WorkSummary[]) {
  const groups = new Map<string, { botId: string; botName: string; items: WorkSummary[] }>()
  for (const item of items) {
    const group = groups.get(item.ownerId) ?? { botId: item.ownerId, botName: item.ownerName, items: [] }
    group.items.push(item)
    groups.set(item.ownerId, group)
  }
  return [...groups.values()].sort((a, b) => {
    const aNeeds = a.items.filter(i => i.status === 'needs_oscar').length
    const bNeeds = b.items.filter(i => i.status === 'needs_oscar').length
    if (aNeeds !== bNeeds) return bNeeds - aNeeds
    return a.botName.localeCompare(b.botName)
  })
}

/** Splits an item's evidence between its owner and each check round, separating same-bot and multi-round check evidence. */
export function partitionEvidence(item: Pick<WorkItem, 'id' | 'ownerId' | 'evidence' | 'checks'>) {
  const owner: Evidence[] = []
  const byRound: Record<number, Evidence[]> = {}
  const checkRounds = new Set(item.checks.map(c => c.round))
  const checkPrefix = `${item.id}:check:`

  const addToRound = (round: number, entry: Evidence) => {
    byRound[round] ??= []
    byRound[round].push(entry)
  }

  for (const entry of item.evidence) {
    if (entry.id.startsWith(checkPrefix)) {
      const round = Number(entry.id.slice(checkPrefix.length).split(':')[0])
      if (Number.isInteger(round) && checkRounds.has(round)) {
        addToRound(round, entry)
        continue
      }
    }
    if (entry.byId !== item.ownerId) {
      const botChecks = item.checks.filter(c => c.by.kind === 'bot' && c.by.id === entry.byId)
      const exact =
        botChecks.find(c => c.settledAt !== null && c.settledAt === entry.at) ??
        botChecks.find(c => entry.at >= c.at && (c.settledAt === null || entry.at <= c.settledAt)) ??
        botChecks[0]
      if (exact) {
        addToRound(exact.round, entry)
        continue
      }
    } else {
      const sameBotMatch = item.checks.find(c => c.sameBot && entry.at >= c.at && (c.settledAt === null || entry.at <= c.settledAt))
      if (sameBotMatch) {
        addToRound(sameBotMatch.round, entry)
        continue
      }
    }
    owner.push(entry)
  }

  return { owner, byRound }
}
