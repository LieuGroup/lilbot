import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import { openDatabase } from '../../server/database/database'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { BrowserSession } from '../../server/http/browser-session'
import { SystemChanges } from '../../server/system/system-changes'
import { LilBotError } from '../../shared/lilbot-error'
import type { EventFrame, ResponseFrame } from '../../shared/protocol'

function bootInstance(dir: string, engine: ScriptedEngine) {
  const intervals: ReturnType<typeof setInterval>[] = []
  const origSetInterval = globalThis.setInterval
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = origSetInterval(...args)
    intervals.push(id)
    return id
  }) as typeof setInterval
  const pushed: EventFrame[] = []
  let handleMcp: ((request: Request) => Response | Promise<Response>) | undefined
  const httpServer = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: request => handleMcp?.(request) ?? new Response('not ready', { status: 503 })
  })
  const services = createAppServices(engine, {
    DATA_DIR: join(dir, 'data'),
    WORKSPACES_DIR: join(dir, 'ws'),
    PORT: httpServer.port!,
    MEMORY_ADAPTER_VERSION: 'none',
    COMMIT: 'test',
    HOOK_ORIGIN: undefined,
    ACCESS_HOST: undefined,
    T3_ENABLED: false,
    publish: frame => pushed.push(frame),
    botsChanged: () => {}
  })
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = origSetInterval
  handleMcp = req => (new URL(req.url).pathname.startsWith('/engine/lilbot/session/') ? services.system.scoped!(req, new URL(req.url).pathname) : services.system.handler(req))
  const makeSession = () => {
    const frames: (ResponseFrame | EventFrame)[] = []
    const s = services
    const session = new BrowserSession(
      s.bots,
      f => frames.push(f),
      s.activity,
      s.routines,
      s.library,
      s.threads,
      s.mcp.browser(() => s.t3Grants.status()),
      s.computers,
      () => undefined,
      s.attachments,
      undefined,
      s.devices,
      s.boards.work,
      s.webhooks,
      s.boards.goals,
      s.notifications,
      s.checkpointChoices
    )
    let nextId = 1
    const call = async (method: string, params: Record<string, unknown>) => {
      const id = nextId++
      await session.handle(JSON.stringify({ id, method, params }))
      const reply = frames.find((f): f is ResponseFrame => 'id' in f && f.id === id)
      if (!reply) throw new Error(`Missing reply for ${method}`)
      if (!reply.ok) throw new LilBotError(reply.error.code, reply.error.message)
      return reply.result as any
    }
    return { session, call, frames }
  }
  const close = () => {
    for (const id of intervals) clearInterval(id)
    services.computers.close()
    services.remoteWorkers.runner.close()
    httpServer.stop(true)
  }
  return { services, pushed, makeSession, close }
}

test('end-to-end Option B+C: split, survive reload/2nd device/restart, auto-resume on skip_piece, dismiss everywhere, guard unsafe & limited', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'option-b-flow-'))
  const prevReviewModel = process.env.LILBOT_REVIEW_MODEL
  const prevSkills = process.env.LILBOT_SKILLS_DIR
  process.env.LILBOT_REVIEW_MODEL = 'review-provider::review-model'
  process.env.LILBOT_SKILLS_DIR = join(dir, 'skills')
  mkdirSync(join(dir, 'skills'), { recursive: true })

  const engine = new ScriptedEngine()
  const inst1 = bootInstance(dir, engine)
  let inst2: ReturnType<typeof bootInstance> | undefined
  try {
    const devA = inst1.makeSession()
    const devB = inst1.makeSession()
    const bot = await devA.call('bots.create', { name: 'Alpha', function: 'Helper', instructions: 'Be helpful.' })
    const opened = await devA.call('chat.open', { botId: bot.id })
    const chatId = opened.chatId as string

    // Two normal turns: one clean, one refused on review, then a stopped turn waiting to auto-resume.
    const answeredTexts: string[] = []
    engine.setTurnHandler(async ctx => {
      if (ctx.hidden) {
        if (ctx.input.text.includes('PRIVATE_REFUSED_TEXT_NEVER_LOGGED')) throw new LilBotError('review_refused', 'Blocked by content policy.')
        return 'Saved clean part.'
      }
      answeredTexts.push(ctx.input.text)
      return ctx.input.text.includes('PRIVATE_REFUSED_TEXT_NEVER_LOGGED') ? 'Acknowledged.' : `Answered: ${ctx.input.text}`
    })

    await devA.call('chat.send', { chatId, text: 'Clean first note about coffee.' })
    await devA.call('chat.send', { chatId, text: 'PRIVATE_REFUSED_TEXT_NEVER_LOGGED' })

    // Clean stopped turn: user message -> memory_save failure before any tool ran.
    const dbSeed = openDatabase(join(dir, 'data', 'lilbot.db'))
    const addEv = (at: number, ev: unknown) =>
      dbSeed.query('INSERT INTO history_events(bot, session, at, event, key) VALUES (?, ?, ?, ?, ?)').run(bot.id, chatId, at, JSON.stringify(ev), crypto.randomUUID())
    addEv(Date.now(), { type: 'user.message', messageId: crypto.randomUUID(), text: 'Please summarize our roadmap.', attachments: [] })
    addEv(Date.now() + 1, { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save' })
    dbSeed.close()

    // Attempt 1 splits cleanly (saving Clean first note), narrows to PRIVATE_REFUSED_TEXT_NEVER_LOGGED (singleMessage: true).
    await expect(engine.triggerPreCompress(bot.id, chatId)).rejects.toMatchObject({ code: 'review_refused' })
    expect(await devA.call('memory.checkpointPending', { botId: bot.id, chatId })).toBeNull()

    // Attempt 2 refuses only the single narrowed message -> waiting card appears on BOTH Device A and Device B!
    await expect(engine.triggerPreCompress(bot.id, chatId)).rejects.toMatchObject({ code: 'review_refused' })
    const pendingA = await devA.call('memory.checkpointPending', { botId: bot.id, chatId })
    const pendingB = await devB.call('memory.checkpointPending', { botId: bot.id, chatId })
    expect(pendingA).toMatchObject({ botId: bot.id, chatId, refusalCount: 2, singleMessage: true, usedTwoModels: true })
    expect(pendingA.pieceAt).toBeNumber()
    expect(pendingB).toEqual(pendingA)
    expect(inst1.pushed.some(ev => ev.event === 'memory.changed')).toBe(true)

    // Limited or non-main session cannot query or submit a checkpoint choice.
    expect(await devA.call('memory.checkpointPending', { botId: bot.id, chatId: 'other-hidden-chat' })).toBeNull()
    await expect(devA.call('memory.checkpointChoose', { botId: bot.id, chatId: 'other-hidden-chat', pieceKey: pendingA.pieceKey, choice: 'skip_piece' })).rejects.toMatchObject({
      code: 'checkpoint_choice_forbidden'
    })

    // Simulate a full server restart while waiting: close inst1, boot inst2 on the same SQLite + engine!
    devA.session.close()
    devB.session.close()
    inst1.close()
    inst2 = bootInstance(dir, engine)
    const devA2 = inst2.makeSession()
    const devB2 = inst2.makeSession()
    await devA2.call('chat.open', { botId: bot.id })
    await devB2.call('chat.open', { botId: bot.id })
    const afterRestartA = await devA2.call('memory.checkpointPending', { botId: bot.id, chatId })
    const afterRestartB = await devB2.call('memory.checkpointPending', { botId: bot.id, chatId })
    expect(afterRestartA).toEqual(pendingA)
    expect(afterRestartB).toEqual(pendingA)

    // Device A clicks "Compact & continue" -> marks piece skipped, emits memory.changed, disappears everywhere, AND auto-resumes!
    const beforeAnswered = answeredTexts.length
    const chosen = await devA2.call('memory.checkpointChoose', { botId: bot.id, chatId, pieceKey: pendingA.pieceKey, choice: 'skip_piece' })
    expect(chosen).toEqual({ ok: true, choice: 'skip_piece', resumed: true })
    expect(await devA2.call('memory.checkpointPending', { botId: bot.id, chatId })).toBeNull()
    expect(await devB2.call('memory.checkpointPending', { botId: bot.id, chatId })).toBeNull()
    expect(inst2.pushed.some(ev => ev.event === 'memory.changed')).toBe(true)

    // Wait briefly for the scheduled auto-resume turn to complete cleanly with the original prompt.
    const deadline = Date.now() + 3000
    while (answeredTexts.length === beforeAnswered && Date.now() < deadline) await Bun.sleep(20)
    expect(answeredTexts.at(-1)).toBe('Please summarize our roadmap.')

    // Next pre-compress skips ONLY the chosen piece and succeeds cleanly.
    const saved = await engine.triggerPreCompress(bot.id, chatId)
    expect(saved).toMatchObject({ saved: true })

    const dbCheck = openDatabase(join(dir, 'data', 'lilbot.db'))
    try {
      const recent = new SystemChanges(dbCheck).recent(10)
      expect(recent.find(row => row.tool === 'memory_checkpoint_choice')).toMatchObject({
        botId: bot.id,
        botName: 'Alpha',
        target: pendingA.pieceKey,
        fields: 'by=oscar, choice=skip_piece'
      })
      expect(JSON.stringify(recent)).not.toContain('PRIVATE_REFUSED_TEXT_NEVER_LOGGED')
    } finally {
      dbCheck.close()
    }
    devA2.session.close()
    devB2.session.close()
  } finally {
    inst2?.close()
    if (!inst2) inst1.close()
    if (prevReviewModel === undefined) delete process.env.LILBOT_REVIEW_MODEL
    else process.env.LILBOT_REVIEW_MODEL = prevReviewModel
    if (prevSkills === undefined) delete process.env.LILBOT_SKILLS_DIR
    else process.env.LILBOT_SKILLS_DIR = prevSkills
    rmSync(dir, { recursive: true, force: true })
  }
})
