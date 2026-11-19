/** React hook: the files waiting in one bot's composer, from picking to ready-to-send. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attachment } from '../../../shared/attachment-schema'
import { messageOf } from '../app/lilbot-socket'
import { useBotStore } from '../bots/bot-store'
import { type AttachmentLimits, splitBySlots } from './attachment-rules'
import { loadLimits, prepareFiles, uploadFile } from './attachment-upload'

export interface StagedFile {
  /** Local key, known before the server gives the file an id. */
  key: string
  name: string
  size: number
  /** A picture made from the local bytes, for image files. */
  preview?: string
  /** `preparing` until the server has reserved the file. */
  state: 'preparing' | Attachment['state']
  attachment?: Attachment
  reason?: Attachment['reason']
}

interface Staged {
  botId: string
  files: StagedFile[]
  leftOut: number
}

let nextKey = 0
const revoke = (files: StagedFile[]) => {
  for (const file of files) if (file.preview) URL.revokeObjectURL(file.preview)
}

export function useStagedAttachments(botId: string) {
  const [staged, setStaged] = useState<Staged>({ botId, files: [], leftOut: 0 })
  const [limits, setLimits] = useState<AttachmentLimits>()
  const current = useRef(staged)
  current.current = staged
  const uploads = useRef(new Map<string, AbortController>())

  /** Changes this bot's files only; answers that arrive after a switch to another bot are dropped. */
  const change = useCallback(
    (update: (files: StagedFile[]) => StagedFile[], leftOut = 0) =>
      setStaged(state => (state.botId === botId ? { ...state, files: update(state.files), leftOut: state.leftOut + leftOut } : state)),
    [botId]
  )
  const patch = useCallback((key: string, fields: Partial<StagedFile>) => change(files => files.map(file => (file.key === key ? { ...file, ...fields } : file))), [change])

  // Asked once the socket is up; the drop area and the refusal texts show the answer.
  const connected = useBotStore(state => state.connected)
  useEffect(() => {
    if (!connected) return
    loadLimits()
      .then(setLimits)
      .catch(failure => console.warn('Attachment limits unavailable:', messageOf(failure)))
  }, [connected])

  // Another bot: its own empty composer. Unmounting drops the pictures and stops the uploads.
  useEffect(() => {
    setStaged(state => (state.botId === botId ? state : { botId, files: [], leftOut: 0 }))
    const running = uploads.current
    return () => {
      revoke(current.current.files)
      for (const controller of running.values()) controller.abort()
      running.clear()
    }
  }, [botId])

  const add = useCallback(
    async (picked: File[]) => {
      if (picked.length === 0) return
      const known = limits ?? (await loadLimits().catch(() => undefined))
      if (!known) return
      const accepted = current.current.files.filter(file => file.state !== 'refused').length
      const { take, leftOut } = splitBySlots(picked, accepted, known)
      const added = take.map(file => ({
        key: `staged-${++nextKey}`,
        name: file.name,
        size: file.size,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        state: 'preparing' as const
      }))
      change(files => [...files, ...added], leftOut)
      if (take.length === 0) return

      let records: Attachment[]
      try {
        records = await prepareFiles(botId, take)
      } catch (failure) {
        const reason = { code: 'prepare_failed', message: `Could not attach the file. ${messageOf(failure)}` }
        for (const file of added) patch(file.key, { state: 'refused', reason })
        return
      }
      // The server counts only this batch; a file past its limit joins the "left out" line.
      const tooMany = new Set(records.flatMap((record, index) => (record.reason?.code === 'too_many_files' ? [added[index].key] : [])))
      if (tooMany.size > 0) {
        revoke(added.filter(file => tooMany.has(file.key)))
        change(files => files.filter(file => !tooMany.has(file.key)), tooMany.size)
      }
      records.forEach((record, index) => {
        const { key } = added[index]
        if (tooMany.has(key)) return
        patch(key, { attachment: record, state: record.state, reason: record.reason })
        if (record.state !== 'uploading') return
        const controller = new AbortController()
        uploads.current.set(key, controller)
        uploadFile(record, take[index], controller.signal)
          .then(result => patch(key, { attachment: result, state: result.state, reason: result.reason }))
          .catch(() => {}) // Aborted: the file was removed or the composer closed.
          .finally(() => uploads.current.delete(key))
      })
    },
    [botId, limits, change, patch]
  )

  const remove = useCallback(
    (key: string) => {
      uploads.current.get(key)?.abort()
      revoke(current.current.files.filter(file => file.key === key))
      change(files => files.filter(file => file.key !== key))
    },
    [change]
  )

  /** After sending: the files now belong to the message. */
  const clear = useCallback(() => {
    revoke(current.current.files)
    setStaged({ botId, files: [], leftOut: 0 })
  }, [botId])

  const dismissLeftOut = useCallback(() => setStaged(state => ({ ...state, leftOut: 0 })), [])

  const files = staged.botId === botId ? staged.files : []
  return {
    files,
    leftOut: staged.botId === botId ? staged.leftOut : 0,
    limits,
    busy: files.some(file => file.state === 'preparing' || file.state === 'uploading'),
    ready: files.flatMap(file => (file.state === 'ready' && file.attachment ? [file.attachment] : [])),
    add,
    remove,
    clear,
    dismissLeftOut
  }
}

export type StagedAttachments = ReturnType<typeof useStagedAttachments>
