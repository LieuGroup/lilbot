import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createStagedTracker,
  measurePickedFiles,
  normalizePickedPhoto,
  PHOTO_PERMISSION_DENIED_MESSAGE,
  PHOTO_PICKER_REPRESENTATION_MODE
} from '../../ios/src/attachments/attachment-helpers'
import { composerActionState } from '../../ios/src/chat/composer-state'
import { sameTranscriptRow, type TranscriptRow } from '../../ios/src/chat/message-rows'
import { clearRowHeights, getRowHeights, MAX_MEASURED_HEIGHTS, recordRowHeight } from '../../ios/src/chat/store'
import { authHeadersForUrl, httpOrigin, resolveServerAssetUrl, socketUrl } from '../../ios/src/connection/asset-url'

describe('PR 299 security, HEIC picking, attachment lifecycle, and scroll/polish guards', () => {
  test('same-origin URL & Access JWT guards reject cross-origin URLs and never leak cf-access-jwt-assertion', () => {
    const server = 'https://lilbot.example.com'
    expect(httpOrigin('lilbot.example.com/')).toBe(server)
    expect(socketUrl(server)).toBe('wss://lilbot.example.com/ws')

    expect(resolveServerAssetUrl('/api/attachments/a1', server)).toBe('https://lilbot.example.com/api/attachments/a1')
    expect(resolveServerAssetUrl('api/attachments/a1', server)).toBe('https://lilbot.example.com/api/attachments/a1')
    expect(resolveServerAssetUrl('https://lilbot.example.com/api/attachments/a1', server)).toBe('https://lilbot.example.com/api/attachments/a1')

    for (const untrusted of [
      'https://evil.example/api/attachments/a1',
      'https://lilbot.example.com.evil.example/api/attachments/a1',
      'https://lilbot.example.com:8443/api/attachments/a1',
      'http://lilbot.example.com/api/attachments/a1',
      '//evil.example/api/attachments/a1',
      'javascript:alert(1)',
      ''
    ]) {
      expect(resolveServerAssetUrl(untrusted, server)).toBeNull()
      expect(authHeadersForUrl(untrusted, server, 'secret-jwt')).toEqual({})
    }

    expect(authHeadersForUrl('https://lilbot.example.com/api/attachments/a1', server, ' secret-jwt ')).toEqual({
      'cf-access-jwt-assertion': 'secret-jwt'
    })
    expect(authHeadersForUrl('https://lilbot.example.com/api/attachments/a1', server, '   ')).toEqual({})
    expect(authHeadersForUrl('/api/attachments/a1', server, 'secret-jwt')).toEqual({})
  })

  test('HEIC photo normalization and real byte measurement prevent unsupported_image and size_mismatch', async () => {
    expect(PHOTO_PICKER_REPRESENTATION_MODE).toBe('compatible')
    expect(PHOTO_PERMISSION_DENIED_MESSAGE).toContain('Settings')

    expect(normalizePickedPhoto({ uri: 'file:///IMG_001.jpg', fileName: 'IMG_001.HEIC', fileSize: null, mimeType: 'image/jpeg' }, 0)).toEqual({
      uri: 'file:///IMG_001.jpg',
      name: 'IMG_001.jpg',
      size: 0,
      mime: 'image/jpeg'
    })
    expect(normalizePickedPhoto({ uri: 'file:///shot.png', fileName: 'shot.png', fileSize: 4096, mimeType: 'image/png' }, 1)).toEqual({
      uri: 'file:///shot.png',
      name: 'shot.png',
      size: 4096,
      mime: 'image/png'
    })

    const measured = await measurePickedFiles(
      [
        { uri: 'file:///a.heic', name: 'IMG_2.heic', size: 0, mime: 'application/octet-stream' },
        { uri: 'file:///broken', name: 'bad.pdf', size: 0, mime: 'application/pdf' }
      ],
      async uri => {
        if (uri === 'file:///broken') throw new Error('ENOENT')
        return new Blob([new Uint8Array(1234)], { type: 'image/jpeg' })
      }
    )
    expect(measured[0].error).toBeUndefined()
    expect(measured[0].file.size).toBe(1234)
    expect(measured[0].file.mime).toBe('image/jpeg')
    expect(measured[0].file.name).toBe('IMG_2.jpg')
    expect(measured[0].file.blob?.size).toBe(1234)
    expect(measured[1].error).toContain('Could not read')
  })

  test('createStagedTracker cancels uploads on remove-while-preparing and bot-switch-while-preparing', () => {
    const tracker = createStagedTracker('bot-a')
    const { generation: genA } = tracker.snapshot()
    expect(tracker.isCurrent('bot-a', genA, 'k1')).toBe(true)

    // Removing a preparing item before prepareFiles finishes prevents uploadFile registration and aborts controller.
    tracker.remove('k1')
    expect(tracker.isCurrent('bot-a', genA, 'k1')).toBe(false)
    const lateRemoved = new AbortController()
    expect(tracker.registerUpload('bot-a', genA, 'k1', lateRemoved)).toBe(false)
    expect(lateRemoved.signal.aborted).toBe(true)
    expect(tracker.activeUploadCount()).toBe(0)

    // Active upload on bot-a is aborted when switching to bot-b; stale bot-a uploads cannot register after switch.
    const activeA = new AbortController()
    expect(tracker.registerUpload('bot-a', genA, 'k2', activeA)).toBe(true)
    expect(tracker.activeUploadCount()).toBe(1)

    tracker.reset('bot-b')
    expect(activeA.signal.aborted).toBe(true)
    expect(tracker.activeUploadCount()).toBe(0)
    expect(tracker.isCurrent('bot-a', genA)).toBe(false)

    const lateStale = new AbortController()
    expect(tracker.registerUpload('bot-a', genA, 'k3', lateStale)).toBe(false)
    expect(lateStale.signal.aborted).toBe(true)
    expect(tracker.activeUploadCount()).toBe(0)
  })

  test('composerActionState stopping branch and height cache cap/clear guards hold', () => {
    // Kills M5: running with draft, ready attachments, or active uploads never shows Stop.
    expect(composerActionState({ ready: true, running: true, draft: 'next', readyAttachments: 0, uploadingAttachments: false }).stopping).toBe(false)
    expect(composerActionState({ ready: true, running: true, draft: '', readyAttachments: 1, uploadingAttachments: false }).stopping).toBe(false)
    expect(composerActionState({ ready: true, running: true, draft: '', readyAttachments: 0, uploadingAttachments: true }).stopping).toBe(false)
    expect(composerActionState({ ready: true, running: true, draft: '   ', readyAttachments: 0, uploadingAttachments: false }).stopping).toBe(true)

    const bot = 'cap-test-bot'
    clearRowHeights(bot)
    for (let i = 0; i < MAX_MEASURED_HEIGHTS + 25; i++) recordRowHeight(bot, `id:${i}`, 40 + (i % 10))
    const cached = getRowHeights(bot)
    expect(Object.keys(cached).length).toBe(MAX_MEASURED_HEIGHTS)
    expect(cached['id:0']).toBeUndefined()
    expect(cached[`id:${MAX_MEASURED_HEIGHTS + 24}`]).toBeDefined()
    clearRowHeights(bot)
    expect(getRowHeights(bot)).toEqual({})

    const item = { kind: 'assistant' as const, id: 'a1', text: 'Done' }
    const rowA: TranscriptRow = { kind: 'message', key: 'id:a1', item, queued: false, inTurn: false, beforeTool: false }
    const rowB: TranscriptRow = { kind: 'message', key: 'id:a1', item, queued: false, inTurn: false, beforeTool: false }
    const rowC: TranscriptRow = { kind: 'message', key: 'id:a1', item: { ...item, text: 'Done!' }, queued: false, inTurn: false, beforeTool: false }
    expect(sameTranscriptRow(rowA, rowB)).toBe(true)
    expect(sameTranscriptRow(rowA, rowC)).toBe(false)
    expect(sameTranscriptRow(rowA, { ...rowA, inTurn: true })).toBe(false)
  })

  test('source wiring enforces Compatible picker, same-origin auth, bounded scroll settle, AX-only overlay, 44 pt targets, and streaming memoization', () => {
    const root = process.cwd()
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
    const uploadSrc = read('ios/src/attachments/attachment-upload.ts')
    const stagedSrc = read('ios/src/attachments/use-staged-attachments.ts')
    const compAttachSrc = read('ios/src/attachments/composer-attachments.tsx')
    const sentAttachSrc = read('ios/src/attachments/sent-attachments.tsx')
    const composerSrc = read('ios/src/chat/composer.tsx')
    const scrollSrc = read('ios/src/chat/use-scroll-restore.ts')
    const rowSrc = read('ios/src/chat/transcript-row.tsx')
    const listSrc = read('ios/src/chat/message-list.tsx')
    const useChatSrc = read('ios/src/chat/use-chat.ts')

    expect(uploadSrc).toContain('requestMediaLibraryPermissionsAsync')
    expect(uploadSrc).toContain('preferredAssetRepresentationMode')
    expect(uploadSrc).toContain('serverAuthHeadersFor(target)')
    expect(uploadSrc).not.toContain('serverAuthHeaders()')

    expect(stagedSrc).toContain('current.current.botId === botId')
    expect(stagedSrc).toContain('measurePickedFiles')
    expect(stagedSrc).toContain('tracker.isCurrent(botId, gen, key)')

    expect(compAttachSrc).toContain('callbacks.current')
    expect(compAttachSrc).toContain('width: 44, height: 44')

    expect(sentAttachSrc).toContain('serverAuthHeadersFor(uri)')
    expect(sentAttachSrc).not.toContain('serverAuthHeaders()')
    expect(sentAttachSrc).toContain('image-viewer-backdrop')
    expect(sentAttachSrc).toContain('paddingRight: Math.max(16, insets.right)')
    expect(sentAttachSrc).toContain('minHeight: 44')

    expect(composerSrc).toContain('fontScale >= AX_FOCUS_OVERLAY_MIN_SCALE')
    expect(composerSrc).toContain('staged.reportError(messageOf(failure))')

    expect(scrollSrc).toContain('SETTLE_SHORT_CONTENT_MS')
    expect(scrollSrc).not.toContain('if (Math.max(0, contentHeight - viewportHeight.current) < plan.offset) return')
    expect(scrollSrc).toContain('isReduceMotionEnabled')
    expect(scrollSrc).toContain('animated: !reduceMotion.current')

    expect(rowSrc).toContain('areTranscriptRowPropsEqual')
    expect(listSrc).toContain('windowSize={9}')
    expect(listSrc).toContain('fallbackNowRef.current')
    expect(listSrc).not.toContain('!scroll.showJumpDown')
    expect(useChatSrc).toContain('clearRowHeights(botId)')
  })
})
