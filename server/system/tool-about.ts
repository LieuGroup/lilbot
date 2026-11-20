/** `lilbot_about`, `lilbot_guide` and `lilbot_status`: what a bot reads to know where it is and how LilBot is doing. */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { LilBotError } from '../../shared/protocol'
import { signInMessage } from '../connections/t3-grant'
import { deployNotice, deployStatus } from '../deploy/deploy-notice'
import { type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'
import { codingState } from './system-note-facts'

const GUIDE = join(import.meta.dir, 'guide')
const RECENT_CHANGES = 8
const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null)

/** Guide topics are the Markdown files shipped in `guide/`; the first line of each is its summary. */
const topics = () =>
  readdirSync(GUIDE)
    .filter(file => file.endsWith('.md'))
    .map(file => file.slice(0, -3))
    .sort()
const summary = (topic: string) =>
  readFileSync(join(GUIDE, `${topic}.md`), 'utf8')
    .split('\n', 1)[0]
    .replace(/^#\s*/, '')

export function aboutTools({ bots, workspaces, computers, t3, commit, dataDir, changes }: SystemDeps): McpTool[] {
  const guideTopics = topics()
  const computerRows = () =>
    computers.list().map(computer => ({ id: computer.id, name: computer.name, os: computer.os, online: computer.online, lastSeen: iso(computer.lastSeen) }))
  return [
    readTool(
      'lilbot_about',
      'Live facts about you and LilBot: your identity, the other bots, computers, T3 Code sign-in, running release, deploy status and what bots changed recently.',
      z.object({}),
      async caller => {
        const all = await bots.listBots()
        const me = all.find(bot => bot.id === caller)
        if (!me) throw new LilBotError('bot_not_found', 'That bot does not exist.')
        return {
          you: { id: me.id, name: me.name, function: me.function, model: me.model, folder: workspaces.pathFor(me.id), primary: me.isPrimary },
          bots: all.filter(bot => bot.id !== caller).map(bot => ({ id: bot.id, name: bot.name, function: bot.function, primary: bot.isPrimary })),
          computers: computerRows().map(({ id, name, online }) => ({ id, name, online })),
          codingThroughT3: codingState(t3()),
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
      async (_caller, { topic }) => (topic ? { topic, guide: readFileSync(join(GUIDE, `${topic}.md`), 'utf8') } : { topics: guideTopics.map(name => `${name}: ${summary(name)}`) })
    ),
    readTool('lilbot_status', 'Status of T3 Code coding, the computers or deployment.', z.object({ area: z.enum(['t3', 'computers', 'deploy']) }), async (_caller, { area }) => {
      if (area === 'computers') return computerRows()
      if (area === 'deploy') return { running: commit.slice(0, 12), latest: deployStatus(dataDir) ?? null, lastFailure: deployNotice(dataDir) ?? null }
      const status = t3()
      return { state: status.state, expiresAt: iso(status.expiresAt), ...(status.state === 'connected' ? {} : { whatToTellOscar: signInMessage(status) }) }
    })
  ]
}
