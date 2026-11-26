/** `lilbot_about`, `lilbot_guide` and `lilbot_status`: what a bot reads to know where it is and how LilBot is doing. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { signInMessage } from '../connections/t3-grant'
import { deployNotice, deployStatus } from '../deploy/deploy-notice'
import { type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'
import { codingState } from './system-note-facts'

const GUIDE = join(import.meta.dir, 'guide')
const RECENT_CHANGES = 8
const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null)

/** Guide topics are the Markdown files shipped in `guide/`; T3-mode overrides live in `guide/t3/`. */
const topics = () =>
  readdirSync(GUIDE)
    .filter(file => file.endsWith('.md'))
    .map(file => file.slice(0, -3))
    .sort()
const guidePath = (topic: string, t3On: boolean) => {
  const override = join(GUIDE, 't3', `${topic}.md`)
  return t3On && existsSync(override) ? override : join(GUIDE, `${topic}.md`)
}
const summary = (topic: string, t3On: boolean) => readFileSync(guidePath(topic, t3On), 'utf8').split('\n', 1)[0].replace(/^#\s*/, '')

export function aboutTools({ bots, workspaces, computers, t3, t3Enabled, commit, dataDir, changes, connections }: SystemDeps): McpTool[] {
  const t3On = Boolean(t3Enabled)
  const guideTopics = topics()
  const computerRows = () =>
    computers.list().map(computer => ({
      id: computer.id,
      name: computer.name,
      os: computer.os,
      online: computer.online,
      main: computer.main,
      lastSeen: iso(computer.lastSeen),
      ...(computer.workerAgents?.length ? { workerAgents: computer.workerAgents } : {})
    }))
  const statusAreas = t3On ? (['t3', 'computers', 'deploy', 'connections'] as const) : (['computers', 'deploy', 'connections'] as const)
  return [
    readTool(
      'lilbot_about',
      t3On
        ? 'Live facts about you and LilBot: your identity, the other bots, computers, T3 Code sign-in, running release, deploy status and what bots changed recently.'
        : 'Live facts about you and LilBot: your identity, the other bots, computers, running release, deploy status and what bots changed recently.',
      z.object({}),
      async caller => {
        const all = await bots.listBots()
        const me = all.find(bot => bot.id === caller)
        if (!me) throw new LilBotError('bot_not_found', 'That bot does not exist.')
        return {
          you: { id: me.id, name: me.name, function: me.function, model: me.model, folder: workspaces.pathFor(me.id), primary: me.isPrimary },
          bots: all.filter(bot => bot.id !== caller).map(bot => ({ id: bot.id, name: bot.name, function: bot.function, primary: bot.isPrimary })),
          computers: computerRows().map(({ id, name, online, main }) => ({ id, name, online, main })),
          ...(t3On ? { codingThroughT3: codingState(t3()) } : {}),
          release: commit.slice(0, 12),
          deploy: { latest: deployStatus(dataDir), lastFailure: deployNotice(dataDir) ?? null },
          recentChanges: changes.recent(RECENT_CHANGES).map(change => ({ ...change, at: iso(change.at) }))
        }
      }
    ),
    readTool(
      'lilbot_guide',
      'How a part of LilBot works and the rules for changing it. Without a topic, lists the topics.',
      z.object({ topic: z.enum(guideTopics as [string, ...string[]]).optional() }),
      async (_caller, { topic }) =>
        topic ? { topic, guide: readFileSync(guidePath(topic, t3On), 'utf8') } : { topics: guideTopics.map(name => `${name}: ${summary(name, t3On)}`) }
    ),
    readTool(
      'lilbot_status',
      t3On
        ? 'Status of T3 Code coding, the computers, deployment or the MCP services bots added (connections).'
        : 'Status of the computers, deployment or the MCP services bots added (connections).',
      z.object({ area: z.enum(statusAreas) }),
      async (_caller, { area }) => {
        if (area === 'computers') return computerRows()
        if (area === 'connections')
          return connections
            .list()
            .map(({ id, name, address, state, addedBy, lastWorkedAt, tools }) => ({ id, name, address, state, addedBy, lastWorked: iso(lastWorkedAt), tools }))
        if (area === 'deploy') return { running: commit.slice(0, 12), latest: deployStatus(dataDir) ?? null, lastFailure: deployNotice(dataDir) ?? null }
        const status = t3()
        return { state: status.state, expiresAt: iso(status.expiresAt), ...(status.state === 'connected' ? {} : { whatToTellTheOwner: signInMessage(status) }) }
      }
    )
  ]
}
