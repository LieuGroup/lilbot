import { expect, test } from 'bun:test'
import { reopenChat } from '../../live-checks/restart-server'

test('reopening retries a transient startup refusal without resubmitting work', async () => {
  let attempts = 0
  const chat = await reopenChat(async () => {
    if (++attempts === 1) throw new Error('{"code":"hermes_request_failed"}')
    return { chatId: 'same-chat', running: false }
  })
  expect(chat.chatId).toBe('same-chat')
  expect(attempts).toBe(2)
}, 5000)

test('reopening surfaces permanent refusals and bounds retries', async () => {
  await expect(
    reopenChat(async () => {
      throw new Error('bot_not_found')
    })
  ).rejects.toThrow('bot_not_found')
  await expect(
    reopenChat(async () => {
      throw new Error('engine_unavailable')
    }, 0)
  ).rejects.toThrow('engine_unavailable')
})
