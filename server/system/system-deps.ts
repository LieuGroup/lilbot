/** What the tools of LilBot's MCP server call: the same services the screens use. */
import type { T3ConnectionStatus } from '../../shared/connections-schema'
import type { ActivityService } from '../activity/activity-service'
import type { BotService } from '../bots/bot-service'
import type { BotStore } from '../bots/bot-store'
import type { Workspaces } from '../bots/workspaces'
import type { ComputerService } from '../computers/computer-service'
import type { MemoryService } from '../memory/memory-service'
import type { DelegationControl } from '../threads/delegation-control'
import type { DelegationService } from '../threads/delegation-service'
import type { WorkService } from '../work/work-service'
import type { WebhookService } from '../webhooks/webhook-service'
import type { SystemChanges } from './system-changes'

/** What the note and `lilbot_about` read. Everything is synchronous so the note can be built whenever an engine applies a bot. */
export interface SystemFacts {
  store: BotStore
  workspaces: Workspaces
  computers: ComputerService
  t3: () => T3ConnectionStatus
  /** The running release. */
  commit: string
}

export interface SystemDeps extends SystemFacts {
  bots: BotService
  activity: ActivityService
  memory: MemoryService
  memoryChanged: () => void
  delegation: { hand: DelegationService; control: DelegationControl }
  work: WorkService
  webhooks: WebhookService
  changes: SystemChanges
  dataDir: string
}
