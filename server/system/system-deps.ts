/** What the tools of LilBot's MCP server call: the same services the screens use. */
import type { z } from 'zod'
import type { T3ConnectionStatus } from '../../shared/connections-schema'
import type { GiveFileInput } from '../../shared/library-schema'
import type { ActivityService } from '../activity/activity-service'
import type { BotService } from '../bots/bot-service'
import type { BotStore } from '../bots/bot-store'
import type { Workspaces } from '../bots/workspaces'
import type { ComputerService } from '../computers/computer-service'
import type { McpConnections } from '../connections/mcp-connections'
import type { GoalService } from '../goals/goal-service'
import type { HistoryService } from '../history/history-service'
import type { LibraryService } from '../library/library-service'
import type { MemoryService } from '../memory/memory-service'
import type { ReviewOutcomeTracker } from '../memory/review-run'
import type { RoutineService } from '../routines/routine-service'
import type { SkillsService } from '../skills/skills-service'
import type { CallingChats } from '../threads/calling-chats'
import type { DelegationControl } from '../threads/delegation-control'
import type { DelegationService } from '../threads/delegation-service'
import type { GroupService } from '../threads/group-service'
import type { WebhookCallers } from '../webhooks/webhook-callers'
import type { WebhookMessages } from '../webhooks/webhook-messages'
import type { WebhookService } from '../webhooks/webhook-service'
import type { CheckSessions } from '../work/check-sessions'
import type { WorkService } from '../work/work-service'
import type { SessionGrants } from './session-grants'
import type { SystemChanges } from './system-changes'

/** What the note and `lilbot_about` read. Everything is synchronous so the note can be built whenever an engine applies a bot. */
export interface SystemFacts {
  store: BotStore
  workspaces: Workspaces
  computers: ComputerService
  t3: () => T3ConnectionStatus
  /** Whether T3 Code is enabled (`LILBOT_T3_ENABLED=1`). Off by default. */
  t3Enabled?: boolean
  /** The running release. */
  commit: string
}

export interface SystemDeps extends SystemFacts {
  bots: BotService
  activity: ActivityService
  memory: MemoryService
  memoryChanged: () => void
  history: Pick<HistoryService, 'search'>
  skills: SkillsService
  /** Handing work to one bot, and working together in temporary groups. */
  delegation: { hand: DelegationService; control: DelegationControl; groups: GroupService }
  work: WorkService
  library: LibraryService
  routines: RoutineService
  goals: GoalService
  /** Gives a file to the bot's Library from the conversation the call came from (`giveFrom` in `app-work.ts`). */
  giveFile: (botId: string, input: z.infer<typeof GiveFileInput>, knownChatId?: string) => ReturnType<LibraryService['give']>
  webhooks: WebhookService
  /** The MCP services bots add (#187). */
  connections: McpConnections
  /** Which session made a call, and which sessions are checks: a check session only reads and gives its verdict. */
  calls: CallingChats
  checkSessions: CheckSessions
  /** Which calls come from webhook runs, the one message a run may send its bot, and which session made a call. */
  webhookRuns: { callers: WebhookCallers; messages: WebhookMessages; callingChat: (botId: string, requestId: string) => Promise<string | null> }
  changes: SystemChanges
  /** Session-bound grants for limited sessions (checks, webhooks, narrowed hand-offs, reviews). */
  grants?: SessionGrants
  reviewTracker?: ReviewOutcomeTracker
  /** Authenticated T3 forwarder for session-bound `'coding'` grants. */
  t3Forward?: (botId: string, request: Request) => Promise<Response>
  /** Whether a remote worker thread is permitted to read/save memory (narrowed threads without `memory` are refused). */
  workerAllowMemory?: (threadId: string) => boolean
  dataDir: string
}
