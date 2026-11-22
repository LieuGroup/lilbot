/** Wires the leader-side `RemoteWorkerRunner` to LilBot's database, computers, bots, memory, skills, and scoped MCP server. */
import type { Database } from 'bun:sqlite'
import type { BotRecord, BotStore } from './bots/bot-store'
import { withoutNote } from './bots/system-note'
import type { ComputerService } from './computers/computer-service'
import { assembleRemoteWorkerPrompt } from './computers/remote-worker-prompt'
import { RemoteWorkerRunner } from './computers/remote-worker-runner'
import type { RemoteWorkerMcpContext } from './computers/remote-worker-types'
import type { MemoryService } from './memory/memory-service'
import type { SkillsService } from './skills/skills-service'

interface RemoteWorkerAppDeps {
  database: Database
  computers: ComputerService
  store: BotStore
  memory: MemoryService
  skills: SkillsService
  handleMcp: (ctx: RemoteWorkerMcpContext, body: string) => Promise<{ status: number; body: string }>
  computersChanged: () => void
}

export function createRemoteWorkers(deps: RemoteWorkerAppDeps) {
  const runner = new RemoteWorkerRunner({
    db: deps.database,
    botExists: id => deps.store.exists(id),
    isRevoked: id => deps.computers.store.revoked(id),
    handleMcp: deps.handleMcp,
    onCapabilitiesChanged: () => deps.computersChanged()
  })
  deps.computers.onRevoke = id => runner.onRevoke(id)

  const buildSystemPrompt = (bot: BotRecord, computerName: string, cwd: string) => {
    const offered = deps.skills.offered(bot.id)
    let codingSkillBody: string | undefined
    if (offered.some(s => s.name === 'lilbot-coding')) {
      try {
        codingSkillBody = deps.skills.read('lilbot-coding')['SKILL.md']
      } catch {}
    }
    return assembleRemoteWorkerPrompt({
      instructions: withoutNote(bot.instructions),
      botName: bot.name,
      botId: bot.id,
      computerName,
      cwd,
      memoryBlock: deps.memory.contextBlock(bot.id).text,
      skills: offered.map(s => ({ name: s.name, description: s.description })),
      codingSkillBody
    })
  }

  return { runner, buildSystemPrompt }
}
