/** Per-bot staged attachments waiting in the iOS composer, mirroring web's useStagedAttachments 1:1. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attachment } from '../../../shared/attachment-schema'
import { type AttachmentLimits, splitBySlots } from '../../../shared/client/attachments/attachment-rules'
import { messageOf } from '../../../shared/client/socket'
import { useConnectionStore } from '../connection/store'
import { loadLimits, type PickedFile, prepareFiles, uploadFile } from './attachment-upload'

export interface StagedFile {
  key: string
  name: string
  size: number
  previewUri?: string
  state: 'preparing' | Attachment['state']
  attachment?: Attachment
  reason?: Attachment['reason']
}

interface StagedState {
  botId: string
  files: StagedFile[]
  leftOut: number
}

let nextKey = 0
const fromRecord = (record: Attachment) => ({ attachment: record, state: record.state, reason: record.reason })

export function useStagedAttachments(botId: string) {
  const connected = useConnectionStore(state => state.connected)
  const [staged, setStaged] = useState<StagedState>({ botId, files: [], leftOut: 0 })
  const [limits, setLimits] = useState<AttachmentLimits>()
  const current = useRef(staged)
  current.current = staged
  const uploads = useRef(new Map<string, AbortController>())

  const change = useCallback(
    (update: (files: StagedFile[]) => StagedFile[], leftOut = 0) =>
      setStaged(state => (state.botId === botId ? { ...state, files: update(state.files), leftOut: state.leftOut + leftOut } : state)),
    [botId]
  )

  const patch = useCallback((key: string, fields: Partial<StagedFile>) => change(files => files.map(file => (file.key === key ? { ...file, ...fields } : file))), [change])

  useEffect(() => {
    if (!connected) return
    void loadLimits()
      .then(setLimits)
      .catch(() => {})
  }, [connected])

  useEffect(() => {
    setStaged(state => (state.botId === botId ? state : { botId, files: [], leftOut: 0 }))
    const running = uploads.current
    return () => {
      for (const controller of running.values()) controller.abort()
      running.clear()
    }
  }, [botId])

  const add = useCallback(
    async (picked: PickedFile[]) => {
      if (picked.length === 0) return
      let known = limits
      if (!known) {
        try {
          known = await loadLimits()
          setLimits(known)
        } catch (failure) {
          const reason = { code: 'limits_unavailable', message: `Could not attach the file. ${messageOf(failure)}` }
          change(files => [...files, ...picked.map(file => ({ key: `staged-${++nextKey}`, name: file.name, size: file.size, state: 'refused' as const, reason }))])
          return
        }
      }
      const accepted = current.current.files.filter(file => file.state !== 'refused').length
      const { take, leftOut } = splitBySlots(picked, accepted, known)
      const added: StagedFile[] = take.map(file => ({
        key: `staged-${++nextKey}`,
        name: file.name,
        size: file.size,
        previewUri: file.mime.startsWith('image/') ? file.uri : undefined,
        state: 'preparing'
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
      const tooMany = new Set(records.flatMap((record, index) => (record.reason?.code === 'too_many_files' ? [added[index].key] : [])))
      if (tooMany.size > 0) {
        change(files => files.filter(file => !tooMany.has(file.key)), tooMany.size)
      }
      records.forEach((record, index) => {
        const { key } = added[index]
        if (tooMany.has(key)) return
        patch(key, fromRecord(record))
        if (record.state !== 'uploading') return
        const controller = new AbortController()
        uploads.current.set(key, controller)
        void uploadFile(record, take[index], controller.signal)
          .then(result => patch(key, fromRecord(result)))
          .catch(() => {})
          .finally(() => uploads.current.delete(key))
      })
    },
    [botId, change, limits, patch]
  )

  const remove = useCallback(
    (key: string) => {
      uploads.current.get(key)?.abort()
      change(files => files.filter(file => file.key !== key))
    },
    [change]
  )

  const clear = useCallback(() => setStaged({ botId, files: [], leftOut: 0 }), [botId])
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
