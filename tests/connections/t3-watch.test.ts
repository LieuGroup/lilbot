import { expect, test } from 'bun:test'
import { watchT3SignIn } from '../../server/connections/t3-watch'

test('a changed sign-in tells the browsers once and gives every bot its connections again; no change does nothing', async () => {
  let generation = 'signed-out'
  const log: string[] = []
  const timer = watchT3SignIn(
    { generation: () => generation } as never,
    () => log.push('changed'),
    async () => void log.push('refresh'),
    5
  )
  await Bun.sleep(30)
  expect(log).toEqual([])
  generation = '1700000000000'
  await Bun.sleep(40)
  clearInterval(timer)
  expect(log).toEqual(['changed', 'refresh'])
})
