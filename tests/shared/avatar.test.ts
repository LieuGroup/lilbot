import { expect, test } from 'bun:test'
import { AVATAR_COLORS, AVATAR_SHAPES, Avatar, defaultAvatar } from '../../shared/avatar'

test('avatar schema supplies ink only for missing face colour', () => {
  expect(Avatar.parse({ shape: 'circle', color: 'bone' })).toEqual({ shape: 'circle', color: 'bone', faceColor: 'ink' })
  expect(Avatar.parse({ shape: 'star', color: 'ink', faceColor: 'yellow' }).faceColor).toBe('yellow')
  expect(Avatar.safeParse({ shape: 'star', color: 'ink', faceColor: 'invalid' }).success).toBe(false)
})

test('default avatars preserve existing id-derived cover choices and use ink faces', () => {
  expect(defaultAvatar('researcher')).toEqual({ shape: 'hexagon', color: 'red', faceColor: 'ink' })
  for (const id of ['', 'a', 'b', 'longer bot id']) {
    expect(defaultAvatar(id)).toEqual(defaultAvatar(id))
    expect(AVATAR_SHAPES).toContain(defaultAvatar(id).shape)
    expect(AVATAR_COLORS).toContain(defaultAvatar(id).color)
    expect(defaultAvatar(id).faceColor).toBe('ink')
  }
})
