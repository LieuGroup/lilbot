/** Wires `SessionGrants` into checks, webhooks, narrowed hand-offs/groups, and `/engine/*` gates without letting
 *  lower feature folders import from `server/system/`. */
import type { Database } from 'bun:sqlite'
import type { EventFrame } from '../shared/protocol'
import type { WebhookCapability, WebhookRun } from '../shared/webhook-schema'

export interface AppServicesSettings {
  DATA_DIR: string
  WORKSPACES_DIR: string
  PORT: number
  MEMORY_ADAPTER_VERSION: string
  COMMIT: string
  HOOK_ORIGIN: string | undefined
  ACCESS_HOST: string | undefined
  ACCESS_CALLBACK_ENABLED?: boolean
  T3_ENABLED?: boolean
  publish: (frame: EventFrame) => void
  botsChanged: () => void
}

import type { SessionRoot } from './bots/hidden-chats'
import type { McpConnection } from './engines/mcp-connection'
import { type SessionGrant, SessionGrants } from './system/session-grants'
import type { CheckUse } from './work/check-sessions'
import { NO_CHANGES, NO_MEMORY, NO_SKILLS } from './work/check-sessions'

export interface PreparedSession {
  sessionMcp: McpConnection[]
  assertSessionMcpReady: () => void
  onChat: (chatId: string) => void
  primaryChatId?: string
  settle: () => void
}

export function createSessionGrants(
  database: Database,
  token: string,
  rootOf: SessionRoot,
  isMainChat: (botId: string, chatId: string) => boolean,
  connections: () => (grant: SessionGrant) => McpConnection[]
) {
  const grants = new SessionGrants(database, token, rootOf, isMainChat)

  const prepare = (grant: SessionGrant): PreparedSession => {
    const sessionMcp = connections()(grant)
    const required = sessionMcp.map(conn => conn.name)
    return {
      sessionMcp,
      assertSessionMcpReady: () => grants.assertDiscovered(grant.id, required),
      onChat: chatId => grants.bindChat(grant.id, chatId),
      primaryChatId: grant.primaryChatId ?? undefined,
      settle: () => grants.revoke(grant.id)
    }
  }

  return {
    grants,
    prepareCheck: (botId: string, checkId: string) => prepare(grants.ensure({ ownerKey: `check:${checkId}`, botId, scope: { kind: 'check', checkId } })),
    prepareWebhook: (run: WebhookRun, capabilities: WebhookCapability[]) =>
      prepare(grants.ensure({ ownerKey: `webhook:${run.id}`, botId: run.botId, scope: { kind: 'webhook', runId: run.id, capabilities } })),
    prepareNarrowed: (botId: string, threadId: string, capabilities: WebhookCapability[]) =>
      prepare(grants.ensure({ ownerKey: `thread:${threadId}:${botId}`, botId, scope: { kind: 'narrowed', threadId, capabilities } })),
    revokeCheck: (checkId: string) => grants.revokeByOwner(`check:${checkId}`),
    revokeThread: (threadId: string) => grants.revokeByPrefix(`thread:${threadId}:`),
    revokeForBot: (botId: string) => grants.revokeForBot(botId),
    ownsChat: (chatId: string) => grants.ownsChat(chatId),
    ownsActiveGrant: (chatId: string) => grants.hasActiveGrantForChat(chatId),
    hasLegacy: (botId: string) => grants.hasLegacyUngrantedRun(botId),

    inCheck:
      (checkSessions: { refusal: (botId: string, chatId: string | undefined, use: CheckUse) => string | null }) => (botId: string, chatId: string | undefined, use: CheckUse) => {
        const resolved = grants.forChat(botId, chatId)
        if (resolved === 'unknown' || resolved?.scope.kind === 'check') return use === 'memory' ? NO_MEMORY : use === 'skills' ? NO_SKILLS : NO_CHANGES
        return checkSessions.refusal(botId, chatId, use)
      },
    ownChat:
      (stores: {
        routineStore: { isRoutineChat(c: string): boolean }
        threadStore: { isInternal(c: string): boolean }
        webhookStore: { isWebhookChat(c: string): boolean }
        checkStore: { isCheckChat(c: string): boolean }
        mem: { isReview(c: string): boolean }
      }) =>
      (chat: string) =>
        stores.routineStore.isRoutineChat(chat) ||
        stores.threadStore.isInternal(chat) ||
        stores.webhookStore.isWebhookChat(chat) ||
        stores.checkStore.isCheckChat(chat) ||
        grants.ownsChat(chat) ||
        stores.mem.isReview(chat),
    checkRun:
      (runRoutine: (botId: string, prompt: string, opts: import('./engines/bot-engine').RoutineOptions) => Promise<{ status: string }>, line: string) =>
      (botId: string, prompt: string, runId: string, onChat: (chatId: string) => void, model?: import('../shared/bot-schema').BotModel, checkId?: string) => {
        const prepared = prepare(
          grants.ensure({ ownerKey: `check:${checkId ?? runId.replace(/^check-/, '')}`, botId, scope: { kind: 'check', checkId: checkId ?? runId.replace(/^check-/, '') } })
        )
        return runRoutine(botId, prompt, {
          runId,
          hiddenInput: true,
          model,
          access: 'check',
          sessionMcp: prepared.sessionMcp,
          assertSessionMcpReady: prepared.assertSessionMcpReady,
          onChat: id => {
            prepared.onChat(id)
            onChat(id)
          },
          origin: { line }
        })
      },
    grantCapabilities: (botId: string, chatId: string | undefined): WebhookCapability[] | null | undefined => {
      const resolved = grants.forChat(botId, chatId)
      if (resolved === null) return undefined
      if (resolved === 'unknown' || resolved.scope.kind === 'check' || resolved.scope.kind === 'review') return []
      return resolved.scope.capabilities
    }
  }
}

export type AppSessionGrants = ReturnType<typeof createSessionGrants>
