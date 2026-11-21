import { expect, test } from 'bun:test'
import { useBotStore } from '../../web/src/bots/bot-store'
import { testBot } from './test-bot'

const detail = { instructions: 'Be brief.', abilities: [], memoryConnected: true }

test('upsert puts a bot in the list without the Setup fields of a detail', () => {
  useBotStore.setState({ bots: [testBot('a'), testBot('b')] })
  const { upsert } = useBotStore.getState()
  upsert({ ...testBot('b'), name: 'renamed', ...detail })
  upsert({ ...testBot('c'), ...detail })
  const { bots } = useBotStore.getState()
  expect(bots.map(bot => bot.id)).toEqual(['a', 'b', 'c'])
  expect(bots[1]?.name).toBe('renamed')
  for (const bot of bots) for (const field of Object.keys(detail)) expect(field in bot).toBe(false)
})
