/** A webhook service over the in-memory fake engine with a settable clock, and the helper door serving its route. */
import { createHmac } from 'node:crypto'
import { rmSync } from 'node:fs'
import type { ComputerService } from '../../server/computers/computer-service'
import { startPublicDoor } from '../../server/http/public-door'
import { webhookRoute } from '../../server/http/webhook-route'
import { RoutineScheduler } from '../../server/routines/routine-scheduler'
import { HOOK_PATH } from '../../server/webhooks/webhook-address'
import { WebhookService } from '../../server/webhooks/webhook-service'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import type { WebhookCreate } from '../../shared/webhook-schema'
import { fakeService } from '../helpers/fake-engine'
import { until } from '../helpers/until'

const ORIGIN = 'https://door.example'
export const unsigned: WebhookCreate = { requestId: 'one', description: 'Report new issues', source: 'GitHub', createdBy: 'oscar' }

function webhookFixture() {
  const fake = fakeService()
  let time = 1_000_000
  let pushes = 0
  const store = new WebhookStore(fake.database)
  const webhooks = new WebhookService(
    store,
    fake.service,
    'engine-token-for-tests',
    ORIGIN,
    () => pushes++,
    () => time
  )
  const scheduler = new RoutineScheduler(
    webhooks,
    () => {},
    () => time
  )
  return {
    ...fake,
    store,
    webhooks,
    scheduler,
    pushes: () => pushes,
    now: () => time,
    setTime: (value: number) => {
      time = value
    },
    /** The token part of an address. */
    token: (address: string) => HOOK_PATH.exec(new URL(address).pathname)![1],
    clean: () => {
      fake.database.close()
      rmSync(fake.root, { recursive: true, force: true })
    }
  }
}

export function doorFixture() {
  const f = webhookFixture()
  f.setTime(Date.now())
  // Real time: the door's budgets and Stripe tolerance use the clock.
  const door = startPublicDoor({} as ComputerService, 0, { hooks: webhookRoute(f.webhooks) })
  const post = (path: string, body: BodyInit, headers: Record<string, string> = {}, method = 'POST') => fetch(new URL(path, door.url), { method, body, headers })
  const signed = (secret: string, text: string) => `sha256=${createHmac('sha256', secret).update(text).digest('hex')}`
  return {
    ...f,
    door,
    post,
    signed,
    close: () => {
      door.stop(true)
      f.clean()
    }
  }
}

/** The fixture with a webhook, an engine that records each run's prompt, and the scheduler ticked at a given time. */
export async function runFixture(input: WebhookCreate = unsigned) {
  const f = webhookFixture()
  const prompts: string[] = []
  f.engine.runRoutine = async (_botId, prompt, options) => {
    prompts.push(prompt)
    options.onChat(`webhook-chat-${options.runId}`)
    return { status: 'completed', text: 'Labelled issue handled.' }
  }
  const hook = await f.webhooks.create('b1', input)
  const live = () => f.webhooks.find(f.token(hook.address))!
  const send = (text: string, headers: Record<string, string> = {}) => f.webhooks.receive(live(), new TextEncoder().encode(text), new Headers(headers))
  /** The runs the scheduler has under way: a tick is done when they have all ended. */
  const underway = (f.scheduler as unknown as { running: Set<string> }).running
  const tick = async (at: number) => {
    f.setTime(at)
    const started = f.scheduler.tick()
    await until(() => underway.size === 0)
    return started
  }
  return { ...f, prompts, hook, live, send, tick }
}
