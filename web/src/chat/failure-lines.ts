/** LilBot's own words for a turn that failed for a reason LilBot knows, in place of the engine's text. */
import type { ChatItem } from '../../../shared/chat-schema'

type Failure = NonNullable<Extract<ChatItem, { kind: 'error' }>['reason']>

export function failureLine(reason: Failure, botName: string | undefined): string {
  switch (reason) {
    case 'memory_save':
      return `${botName || 'The bot'} couldn't save its memory before shortening this long conversation, so it stopped instead of forgetting anything. Send your message again in a moment.`
  }
}
