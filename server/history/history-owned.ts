/** Which engine sessions are a bot's LilBot conversation. LilBot records only sessions it opened as the bot's main
 *  conversation, the sessions the bot already had before LilBot first listed it (its one-time import), and their
 *  compression continuations. A session started anywhere else (the engine's own apps) is never recorded, shown,
 *  counted as activity or reviewed for memory, whatever the engine lists. An excluded session is never owned. */
import type { Database } from 'bun:sqlite'

export class HistoryOwnership {
  constructor(private db: Database) {}

  /** A session LilBot opened as the bot's main conversation (new, resumed, or after an engine switch). */
  own(bot: string, session: string) {
    if (session) this.db.query("INSERT OR IGNORE INTO history_owned(bot,session,reason,at) VALUES(?,?,'opened',?)").run(bot, session, Date.now())
  }

  owns(bot: string, session: string): boolean {
    return !!this.db
      .query('SELECT 1 FROM history_owned o WHERE o.bot=?1 AND o.session=?2 AND NOT EXISTS (SELECT 1 FROM history_exclusions x WHERE x.bot=?1 AND x.session=?2)')
      .get(bot, session)
  }

  /** The first listing fixes the moment LilBot met the bot: sessions the engine says started before it are the bot's
   *  earlier history and are adopted once. A session without a known start time is never adopted. */
  adoptEarlier(bot: string, listed: readonly { id: string; at: number }[]) {
    this.db.query('INSERT OR IGNORE INTO history_adoption(bot,before) VALUES(?,?)').run(bot, Date.now())
    const { before } = this.db.query('SELECT before FROM history_adoption WHERE bot=?').get(bot) as { before: number }
    const adopt = this.db.query("INSERT OR IGNORE INTO history_owned(bot,session,reason,at) VALUES(?,?,'earlier',?)")
    for (const session of listed) if (session.at > 0 && session.at < before) adopt.run(bot, session.id, Date.now())
  }
}
