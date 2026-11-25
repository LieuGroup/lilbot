/** Executes `memory.checkpointChoose` and automatically resumes a clean stopped turn on `skip_piece`. */
import { LilBotError } from '../../shared/lilbot-error'
import type { CheckpointChoice } from '../../shared/memory-schema'
import type { CheckpointChoices } from '../app-memory'
import type { AttachmentService } from '../attachments/attachment-service'
import type { BotService } from '../bots/bot-service'
import type { DeviceService } from '../devices/device-service'
import type { AfterResponse, BrowserChats } from './browser-chats'
import type { BrowserConnections } from './connection-handlers'

export interface CheckpointChoiceDeps {
  choices?: CheckpointChoices
  bots: BotService
  chats: BrowserChats
  attachments?: AttachmentService
  devices?: DeviceService
  connections?: BrowserConnections
}

export async function handleCheckpointChoice(
  deps: CheckpointChoiceDeps,
  input: { botId: string; chatId: string; pieceKey: string; choice: CheckpointChoice; deviceId?: string },
  afterResponse: AfterResponse
): Promise<{ ok: true; choice: CheckpointChoice; resumed: boolean; needsResend?: boolean }> {
  const { botId, chatId, pieceKey, choice, deviceId } = input
  if (!deps.choices) throw new LilBotError('unavailable', 'Memory checkpoint choices are unavailable.')
  const choices = deps.choices
  choices.choose(botId, chatId, pieceKey, choice)
  if (choice !== 'skip_piece') return { ok: true, choice, resumed: false }
  if (choices.pending(botId, chatId)) return { ok: true, choice, resumed: false }

  if (deps.bots.hasActiveTurn(botId)) return { ok: true, choice, resumed: false, needsResend: true }
  const stopped = choices.stoppedTurn(botId, chatId)
  if (stopped.kind === 'none') return { ok: true, choice, resumed: false }
  if (stopped.kind === 'unsafe') return { ok: true, choice, resumed: false, needsResend: true }

  if (stopped.attachmentIds.length > 0) {
    if (!deps.attachments) return { ok: true, choice, resumed: false, needsResend: true }
    try {
      const files = deps.attachments.status(botId, stopped.attachmentIds)
      if (files.length !== stopped.attachmentIds.length || files.some(file => file.state !== 'ready')) {
        return { ok: true, choice, resumed: false, needsResend: true }
      }
    } catch {
      return { ok: true, choice, resumed: false, needsResend: true }
    }
  }

  afterResponse(() => {
    void resumeStoppedTurn(deps, botId, chatId, stopped, deviceId).catch(error => {
      console.error('[checkpoint-resume] could not resume stopped turn:', error instanceof Error ? error.message : error)
    })
  })
  return { ok: true, choice, resumed: true }
}

async function resumeStoppedTurn(
  deps: CheckpointChoiceDeps,
  botId: string,
  chatId: string,
  stopped: { text: string; attachmentIds: string[]; deviceId?: string },
  fallbackDeviceId?: string
) {
  const existing = deps.chats.find(chatId)
  const opened = existing ? undefined : await deps.bots.openChat(botId, chatId, () => {}, true)
  const chat = existing ?? opened!
  const publishChat = deps.choices?.publishChat
  try {
    await deps.connections?.ready(botId, chatId)
    const origin = deps.devices?.origin(stopped.deviceId ?? fallbackDeviceId)
    const messageId = crypto.randomUUID()
    const files = stopped.attachmentIds.length > 0 && deps.attachments ? deps.attachments.status(botId, stopped.attachmentIds) : []
    publishChat?.(chatId, {
      type: 'user.message',
      messageId,
      text: stopped.text,
      attachments: files,
      images: { support: chat.imageSupport ?? 'unknown', imageCount: files.filter(f => f.mime.startsWith('image/')).length },
      ...(origin?.device ? { origin: origin.device } : {})
    })
    if (stopped.attachmentIds.length > 0 && deps.attachments) {
      await deps.attachments.send(chat, stopped.text, stopped.attachmentIds, messageId, origin)
    } else if (deps.devices && origin) {
      await deps.devices.send(chat, stopped.text, messageId, origin)
    } else {
      await chat.send(stopped.text, { inputId: messageId })
    }
  } catch (error) {
    publishChat?.(chatId, { type: 'error', message: 'Could not resume the previous message automatically. Send it again to continue.' })
    throw error
  } finally {
    opened?.close()
  }
}
