/** The user's own data about bots: sidebar preferences, sections, and which chat is a bot's
 *  main conversation. All SQL for these tables lives here. */
import type { Database } from 'bun:sqlite'

import { Avatar, defaultAvatar } from '../../shared/avatar'
import type { BotPrefs, Section } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/protocol'

interface PrefsRow {
  bot_id: string
  avatar_shape: string | null
  avatar_color: string | null
  section_id: string | null
  pinned: number
  hidden: number
  main_chat_id: string | null
}

export type PrefsPatch = Partial<BotPrefs>

function prefsFrom(botId: string, row: PrefsRow | null): BotPrefs {
  // A stored avatar that is no longer in the lists (they changed) falls back like a missing one.
  const stored = Avatar.safeParse({ shape: row?.avatar_shape, color: row?.avatar_color })
  return { avatar: stored.success ? stored.data : defaultAvatar(botId), sectionId: row?.section_id ?? null, pinned: row?.pinned === 1, hidden: row?.hidden === 1 }
}

export class BotPrefsStore {
  constructor(private db: Database) {}

  private row(botId: string): PrefsRow | null {
    return this.db.query<PrefsRow, [string]>('SELECT * FROM bot_prefs WHERE bot_id = ?').get(botId)
  }

  prefs(botId: string): BotPrefs {
    return prefsFrom(botId, this.row(botId))
  }

  /** Preferences for many bots in one query; bots without a row get the defaults. */
  prefsFor(botIds: string[]): Map<string, BotPrefs> {
    const rows = new Map(
      this.db
        .query<PrefsRow, []>('SELECT * FROM bot_prefs')
        .all()
        .map(row => [row.bot_id, row])
    )
    return new Map(botIds.map(botId => [botId, prefsFrom(botId, rows.get(botId) ?? null)]))
  }

  setPrefs(botId: string, patch: PrefsPatch): BotPrefs {
    if (patch.sectionId && !this.db.query('SELECT 1 FROM sections WHERE id = ?').get(patch.sectionId)) {
      throw new LilBotError('section_not_found', 'That section does not exist.')
    }
    const next = { ...this.prefs(botId), ...patch }
    this.db
      .query(
        `INSERT INTO bot_prefs (bot_id, avatar_shape, avatar_color, section_id, pinned, hidden) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (bot_id) DO UPDATE SET avatar_shape = excluded.avatar_shape, avatar_color = excluded.avatar_color,
           section_id = excluded.section_id, pinned = excluded.pinned, hidden = excluded.hidden`
      )
      .run(botId, next.avatar.shape, next.avatar.color, next.sectionId, next.pinned ? 1 : 0, next.hidden ? 1 : 0)
    return next
  }

  mainChat(botId: string): string | null {
    return this.row(botId)?.main_chat_id ?? null
  }

  setMainChat(botId: string, chatId: string) {
    this.db.query('INSERT INTO bot_prefs (bot_id, main_chat_id) VALUES (?, ?) ON CONFLICT (bot_id) DO UPDATE SET main_chat_id = excluded.main_chat_id').run(botId, chatId)
  }

  primaryBot(): string | null {
    return this.db.query<{ bot_id: string }, []>('SELECT bot_id FROM primary_bot WHERE id = 1').get()?.bot_id ?? null
  }

  setPrimaryBot(botId: string) {
    this.db.query('INSERT INTO primary_bot (id, bot_id) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET bot_id = excluded.bot_id').run(botId)
  }

  /** Drop everything kept about a bot that no longer exists. */
  forgetBot(botId: string) {
    this.db.query('DELETE FROM primary_bot WHERE bot_id = ?').run(botId)
    this.db.query('DELETE FROM bot_prefs WHERE bot_id = ?').run(botId)
  }

  sections(): Section[] {
    return this.db.query<Section, []>('SELECT id, name FROM sections ORDER BY position, name').all()
  }

  createSection(name: string): Section {
    const section = { id: crypto.randomUUID(), name }
    this.db.query('INSERT INTO sections (id, name, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM sections))').run(section.id, name)
    return section
  }

  renameSection(sectionId: string, name: string): Section {
    const { changes } = this.db.query('UPDATE sections SET name = ? WHERE id = ?').run(name, sectionId)
    if (changes === 0) throw new LilBotError('section_not_found', 'That section does not exist.')
    return { id: sectionId, name }
  }

  /** Bots in the section stay; they just no longer belong to a section. */
  deleteSection(sectionId: string) {
    this.db.query('DELETE FROM sections WHERE id = ?').run(sectionId)
  }
}
