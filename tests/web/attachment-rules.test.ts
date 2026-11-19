import { describe, expect, test } from 'bun:test'

import { dropHint, formatBytes, imageNoteText, isImage, leftOutText, newMessageId, refusalText, splitBySlots } from '../../web/src/attachments/attachment-rules'

const limits = { maxFileBytes: 20 * 1024 * 1024, maxFilesPerMessage: 10 }

describe('attachment texts', () => {
  test('sizes are 1024-based and short', () => {
    expect(formatBytes(812)).toBe('812 B')
    expect(formatBytes(4096)).toBe('4 KB')
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2.4 MB')
    expect(formatBytes(48 * 1024 * 1024)).toBe('48 MB')
    expect(formatBytes(limits.maxFileBytes)).toBe('20 MB')
  })

  test('a file that is too large is worded from its size and the server limit', () => {
    expect(refusalText({ size: 48 * 1024 * 1024, reason: { code: 'file_too_large', message: 'The limit is 20 MB per file.' } }, limits)).toBe(
      'Too large: 48 MB. The limit is 20 MB.'
    )
    expect(
      refusalText({ size: 48 * 1024 * 1024, reason: { code: 'file_too_large', message: 'The limit is 50 MB per file.' } }, { ...limits, maxFileBytes: 50 * 1024 * 1024 })
    ).toBe('Too large: 48 MB. The limit is 50 MB.')
  })

  test('any other refusal shows the server sentence', () => {
    expect(refusalText({ size: 1, reason: { code: 'unsupported_image', message: 'Images must be PNG, JPEG, GIF or WebP.' } }, limits)).toBe(
      'Images must be PNG, JPEG, GIF or WebP.'
    )
  })

  test('the left-out line and drop hint use the server limits', () => {
    expect(leftOutText(1, limits)).toBe('1 file was left out. A message takes up to 10.')
    expect(leftOutText(3, limits)).toBe('3 files were left out. A message takes up to 10.')
    expect(dropHint(limits)).toBe('Up to 10 files, 20 MB each')
  })
})

describe('how many files fit', () => {
  test('files already in the composer keep their places', () => {
    expect(splitBySlots([1, 2, 3], 8, limits)).toEqual({ take: [1, 2], leftOut: 1 })
    expect(
      splitBySlots(
        Array.from({ length: 11 }, (_, i) => i),
        0,
        limits
      ).leftOut
    ).toBe(1)
    expect(splitBySlots([1], 10, limits)).toEqual({ take: [], leftOut: 1 })
  })
})

describe('the note about images', () => {
  test('shows only when the server knows the model cannot see images', () => {
    expect(imageNoteText({ support: 'unsupported', imageCount: 2 })).toBe(
      "This bot's model cannot see images. The 2 images were saved to its workspace, but it has not looked at them."
    )
    expect(imageNoteText({ support: 'unsupported', imageCount: 1 })).toBe("This bot's model cannot see images. The image was saved to its workspace, but it has not looked at it.")
    expect(imageNoteText({ support: 'unknown', imageCount: 2 })).toBeUndefined()
    expect(imageNoteText({ support: 'supported', imageCount: 2 })).toBeUndefined()
    expect(imageNoteText({ support: 'unsupported', imageCount: 0 })).toBeUndefined()
    expect(imageNoteText(undefined)).toBeUndefined()
  })
})

test('only the image formats the server accepts are drawn as pictures', () => {
  expect(isImage({ mime: 'image/png' })).toBe(true)
  expect(isImage({ mime: 'image/svg+xml' })).toBe(false)
  expect(isImage({ mime: 'text/plain' })).toBe(false)
})

test('message ids are version 4 UUIDs', () => {
  expect(newMessageId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
