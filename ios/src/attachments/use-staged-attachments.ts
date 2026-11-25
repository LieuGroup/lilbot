/** Per-bot staged attachments waiting in the iOS composer, mirroring web's useStagedAttachments 1:1
 *  with real byte measurement before prepare, bot-switch/remove race guards, and picker error feedback. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attachment } from '../../../shared/attachment-schema'
import { type AttachmentLimits, splitBySlots } from '../../../shared/client/attachments/attachment-rules'
import { messageOf } from '../../../shared/client/socket'
import { useConnectionStore } from '../connection/store'
import { createStagedTracker, measurePickedFiles, type PickedFile } from './attachment-helpers'
import { loadLimits, prepareFiles, readLocalBlob, uploadFile } from './attachment-upload'

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
  pickerError: string
}

let nextKey = 0
const fromRecord = (record: Attachment) => ({ attachment: record, state: record.state, reason: record.reason })

export function useStagedAttachments(botId: string) {
  const connected = useConnectionStore(state => state.connected)
  const [staged, setStaged] = useState<StagedState>({ botId, files: [], leftOut: 0, pickerError: '' })
  const [limits, setLimits] = useState<AttachmentLimits>()
  const current = useRef(staged)
  current.current = staged
  const trackerRef = useRef(createStagedTracker(botId))

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
    const tracker = trackerRef.current
    tracker.reset(botId)
    setStaged(state => (state.botId === botId ? state : { botId, files: [], leftOut: 0, pickerError: '' }))
    return () => tracker.reset('')
  }, [botId])

  const add = useCallback(
    async (picked: PickedFile[]) => {
      if (picked.length === 0) return
      const tracker = trackerRef.current
      const { generation: gen } = tracker.snapshot()
      setStaged(state => (state.botId === botId && state.pickerError ? { ...state, pickerError: '' } : state))

      let known = limits
      if (!known) {
        try {
          known = await loadLimits()
          if (!tracker.isCurrent(botId, gen)) return
          setLimits(known)
        } catch (failure) {
          if (!tracker.isCurrent(botId, gen)) return
          const reason = { code: 'limits_unavailable', message: `Could not attach the file. ${messageOf(failure)}` }
          change(files => [...files, ...picked.map(file => ({ key: `staged-${++nextKey}`, name: file.name, size: file.size, state: 'refused' as const, reason }))])
          return
        }
      }

      const activeFiles = current.current.botId === botId ? current.current.files : []
      const accepted = activeFiles.filter(file => file.state !== 'refused').length
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

      const measured = await measurePickedFiles(take, readLocalBlob)
      if (!tracker.isCurrent(botId, gen)) return

      const readyToPrepare: { file: PickedFile; stagedFile: StagedFile }[] = []
      measured.forEach((entry, index) => {
        const stagedFile = added[index]
        if (!tracker.isCurrent(botId, gen, stagedFile.key)) return
        if (entry.error) {
          patch(stagedFile.key, { state: 'refused', reason: { code: 'read_failed', message: entry.error } })
        } else {
          patch(stagedFile.key, { name: entry.file.name, size: entry.file.size })
          readyToPrepare.push({ file: entry.file, stagedFile })
        }
      })
      if (readyToPrepare.length === 0) return

      let records: Attachment[]
      try {
        records = await prepareFiles(
          botId,
          readyToPrepare.map(entry => entry.file)
        )
      } catch (failure) {
        if (!tracker.isCurrent(botId, gen)) return
        const reason = { code: 'prepare_failed', message: `Could not attach the file. ${messageOf(failure)}` }
        for (const { stagedFile } of readyToPrepare) patch(stagedFile.key, { state: 'refused', reason })
        return
      }
      if (!tracker.isCurrent(botId, gen)) return

      const tooMany = new Set(records.flatMap((record, index) => (record.reason?.code === 'too_many_files' ? [readyToPrepare[index].stagedFile.key] : [])))
      if (tooMany.size > 0) change(files => files.filter(file => !tooMany.has(file.key)), tooMany.size)

      records.forEach((record, index) => {
        const { key } = readyToPrepare[index].stagedFile
        if (tooMany.has(key) || !tracker.isCurrent(botId, gen, key)) return
        patch(key, fromRecord(record))
        if (record.state !== 'uploading') return
        const controller = new AbortController()
        if (!tracker.registerUpload(botId, gen, key, controller)) return
        void uploadFile(record, readyToPrepare[index].file, controller.signal)
          .then(result => {
            if (tracker.isCurrent(botId, gen, key)) patch(key, fromRecord(result))
          })
          .catch(() => {})
          .finally(() => tracker.finishUpload(key, controller))
      })
    },
    [botId, change, limits, patch]
  )

  const remove = useCallback(
    (key: string) => {
      trackerRef.current.remove(key)
      change(files => files.filter(file => file.key !== key))
    },
    [change]
  )

  const clear = useCallback(() => {
    trackerRef.current.reset(botId)
    setStaged({ botId, files: [], leftOut: 0, pickerError: '' })
  }, [botId])

  const dismissLeftOut = useCallback(() => setStaged(state => ({ ...state, leftOut: 0 })), [])
  const reportError = useCallback((message: string) => setStaged(state => (state.botId === botId ? { ...state, pickerError: message } : state)), [botId])
  const dismissError = useCallback(() => setStaged(state => (state.botId === botId ? { ...state, pickerError: '' } : state)), [botId])

  const files = staged.botId === botId ? staged.files : []
  return {
    files,
    leftOut: staged.botId === botId ? staged.leftOut : 0,
    pickerError: staged.botId === botId ? staged.pickerError : '',
    limits,
    busy: files.some(file => file.state === 'preparing' || file.state === 'uploading'),
    ready: files.flatMap(file => (file.state === 'ready' && file.attachment ? [file.attachment] : [])),
    add,
    remove,
    clear,
    dismissLeftOut,
    reportError,
    dismissError
  }
}

export type StagedAttachments = ReturnType<typeof useStagedAttachments>
