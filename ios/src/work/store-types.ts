/** Shared socket contract and store state types for the iOS Work board and Work tab badge.
 *  Zero React Native/Expo imports so unit tests run directly on Linux. */
import type { WorkKind, WorkLevels } from '../../../shared/work-check-schema'
import type { WorkBrief, WorkItem, WorkStatus, WorkSummary } from '../../../shared/work-schema'

export interface WorkSocket {
  connected: boolean
  call(method: 'work.brief', params: { since?: number }): Promise<WorkBrief>
  call(method: 'work.list', params: { botId?: string; status?: WorkStatus[]; from?: number; to?: number; limit?: number }): Promise<WorkSummary[]>
  call(method: 'work.open', params: { itemId: string }): Promise<WorkItem>
  call(method: 'work.answer', params: { itemId: string; answer: string }): Promise<WorkItem>
  call(method: 'work.pass', params: { itemId: string; note?: string }): Promise<WorkItem>
  call(method: 'work.sendBack', params: { itemId: string; reason: string }): Promise<WorkItem>
  call(method: 'work.drop', params: { itemId: string; reason: string }): Promise<WorkItem>
  call(method: 'work.levels.get', params: Record<string, never>): Promise<WorkLevels>
  call(method: 'work.levels.set', params: { kind: WorkKind; botId?: string; level: number | null }): Promise<WorkLevels>
  onWorkChanged(listener: () => void): () => void
  onConnection(listener: (connected: boolean) => void): () => void
}

export interface WorkStoreState {
  brief: WorkBrief | null
  active: WorkSummary[]
  briefError: string
  list: WorkSummary[]
  listLoaded: boolean
  listError: string
  items: Record<string, WorkItem>
  itemErrors: Record<string, string>
  levels: WorkLevels | null
  levelsError: string
  /** Count of actionable `needs_oscar` work items for the Work tab badge (excludes waiting goals until Goals ships). */
  badgeCount: number
}

export const EMPTY_WORK_STATE: WorkStoreState = {
  brief: null,
  active: [],
  briefError: '',
  list: [],
  listLoaded: false,
  listError: '',
  items: {},
  itemErrors: {},
  levels: null,
  levelsError: '',
  badgeCount: 0
}
