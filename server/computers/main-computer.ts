import { LilBotError } from '../../shared/lilbot-error'
import type { ComputerStore } from './computer-store'

/** The main computer: the one bots use when a message comes from a device that is not a computer. At most one: the table
 *  holds a single row. Removing a computer clears its mark (`ComputerStore.revoke`). */
export class MainComputer {
  constructor(
    private store: ComputerStore,
    private changed: () => void
  ) {}

  /** `null` clears the mark. */
  set(id: string | null) {
    if (id !== null && !this.store.list().some(computer => computer.id === id)) throw new LilBotError('computer_not_found', 'This computer does not exist.')
    this.store.db.transaction(() => {
      this.store.db.query('DELETE FROM main_computer').run()
      if (id !== null) this.store.db.query('INSERT INTO main_computer(only, computer_id) VALUES(1, ?)').run(id)
    })()
    this.changed()
    return { ok: true as const }
  }
}
