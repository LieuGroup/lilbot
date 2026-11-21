/** Shared by the check tests: a workFixture whose check runs stay open until released, and the steps every check starts with. */
import type { EvidenceInput } from '../../shared/work-schema'
import { workFixture } from './work-fixture'

export const proof = { proves: 'The site shows version 7', url: 'https://example.com/version' }
export const saw = { proves: 'The page I opened', command: 'curl -s https://example.com/version', output: 'version 6' }
export const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => '',
    (error: Error & { code?: string }) => error.code ?? error.message
  )

/** A workFixture whose check runs stay open until released, so the checking bot can give its verdict meanwhile. */
export function fixture() {
  const f = workFixture()
  let release = () => {}
  f.run.result = new Promise(resolve => {
    release = () => resolve({ status: 'completed' })
  })
  return { ...f, release: () => release() }
}
export type F = ReturnType<typeof fixture>
/** `a` opens a deploy (level 2) and finishes it. */
export async function finish(f: F, extra: Record<string, unknown> = {}) {
  const item = await f.open('a', { kind: 'deploy', ...extra })
  return f.work.act('a', { requestId: `fin-${item.id}`, itemId: item.id, status: 'done', result: 'Version 7 is live', evidence: [proof] })
}
/** Runs the open check and gives `verdict` as the checking bot, from its check session. */
export async function check(f: F, itemId: string, verdict: 'verified' | 'not_verified' | 'could_not_check', evidence: EvidenceInput[] = [saw]) {
  f.checkRuns.tick()
  await Bun.sleep(1)
  const open = f.work.checks.open(itemId)!
  f.state.chats.set(open.by.id!, `check-${open.id}-session`)
  return f.work.act(open.by.id!, { requestId: `v-${open.id}`, itemId, verdict, result: `I read version ${verdict === 'verified' ? 7 : 6}`, evidence })
}
