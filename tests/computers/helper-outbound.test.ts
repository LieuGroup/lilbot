import { expect, test } from 'bun:test'
import { outbound } from '../../helper/outbound'

test('a buffered challenge is retained ahead of results; retry does not wait ten seconds', () => {
  let ready = false
  const frames: any[] = []
  const rows = [{ id: 'large', result: () => JSON.stringify({ output: 'x'.repeat(4 * 1024 * 1024) }) }]
  const sender = outbound(
    frame => {
      if (!ready) return false
      frames.push(frame)
      return true
    },
    () => rows,
    () => ready
  )
  sender.heartbeat('challenge')
  sender.flush(0)
  expect(frames).toHaveLength(0)
  ready = true
  sender.flush(100)
  expect(frames.map(frame => frame.type)).toEqual(['heartbeat', 'result'])
  expect(frames[0].challenge).toBe('challenge')
  sender.flush(4099)
  expect(frames).toHaveLength(2)
  sender.flush(4100)
  expect(frames).toHaveLength(3)
  sender.reset()
  sender.flush(4101)
  expect(frames).toHaveLength(4)
  rows.length = 0
  sender.acknowledge('large')
  sender.flush(10000)
  expect(frames).toHaveLength(4)
})
