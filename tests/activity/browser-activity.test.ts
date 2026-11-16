import { expect, test } from 'bun:test'
import { ActivityService } from '../../server/activity/activity-service'
import { ActivityStore } from '../../server/activity/activity-store'
import { openDatabase } from '../../server/database/database'
import { BrowserSession } from '../../server/http/browser-session'
import { fakeService } from '../helpers/fake-engine'

test('browser open/close and disconnect count viewers; unread API validates the bot', async () => {
  const fake = fakeService()
  const db = openDatabase(':memory:')
  const activity = new ActivityService(new ActivityStore(db), () => {})
  const frames: any[] = []
  const browser = new BrowserSession(fake.service, frame => frames.push(frame), activity)
  let id = 0
  const call = async (method: string, params = {}) => {
    await browser.handle(JSON.stringify({ id: ++id, method, params }))
    return frames.find(frame => frame.id === id)
  }
  const chat = (await call('chat.open', { botId: 'b1' })).result
  activity.observe({ botId: 'b1', chatId: chat.chatId, key: '1', status: 'finished', spoke: true })
  expect((await call('bots.list')).result[0].activity.unread).toBe(false)
  await call('chat.close', { chatId: chat.chatId })
  activity.observe({ botId: 'b1', chatId: chat.chatId, key: '2', status: 'finished', spoke: true })
  expect((await call('bots.list')).result[0].activity.unread).toBe(true)
  await call('chat.open', { botId: 'b1' })
  expect(activity.state('b1').unread).toBe(false)
  browser.close()
  activity.observe({ botId: 'b1', chatId: chat.chatId, key: '3', status: 'finished', spoke: true })
  expect(activity.state('b1').unread).toBe(true)
  const other = new BrowserSession(fake.service, frame => frames.push(frame), activity)
  await other.handle(JSON.stringify({ id: 100, method: 'activity.setUnread', params: { botId: 'missing', unread: true } }))
  expect(frames.find(frame => frame.id === 100).ok).toBe(false)
  activity.close()
  db.close()
})
