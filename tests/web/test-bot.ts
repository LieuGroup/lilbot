import type { BotActivity } from '../../shared/activity-schema'
import { defaultAvatar } from '../../shared/avatar'
import type { Bot, BotPrefs } from '../../shared/bot-schema'

interface Options {
  isPrimary?: boolean
  isDefault?: boolean
  prefs?: Partial<BotPrefs>
  activity?: Partial<BotActivity>
  function?: string
  runnable?: boolean
  runtimePending?: boolean
}

/** A roster bot for web tests. */
export function testBot(id: string, options: Options = {}): Bot {
  return {
    id,
    name: id,
    function: options.function ?? '',
    model: null,
    permissionMode: 'full-access',
    isDefault: options.isDefault ?? false,
    isPrimary: options.isPrimary ?? false,
    runnable: options.runnable ?? true,
    runtimePending: options.runtimePending,
    workspace: '',
    activity: options.activity ? { status: 'idle', text: '', machine: 'leader', unread: false, ...options.activity } : undefined,
    prefs: { avatar: defaultAvatar(id), sectionId: null, pinned: false, pinnedAt: null, hidden: false, ...options.prefs }
  }
}
