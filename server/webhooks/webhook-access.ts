/** What a webhook run may do, chosen in this one place. Which tools runs fed by outside data should have is Oscar's
 *  decision (#12 security review, finding 3). Until then a run is like a routine run: every toolset the bot has, with
 *  full access. To narrow it, set `toolsets` (the engine starts the run's session with only those) and say the same in
 *  `prompt`. Leave `memory` out of a narrowed list: Hermes offers the memory provider's tools only with that toolset,
 *  so with it a run could write shared facts directly (`update_memory`), past both memory reviews. */
export const WEBHOOK_RUN_ACCESS: { toolsets?: string[]; prompt: string } = {
  prompt: "Carry out the webhook's task with full access, without asking for approval."
}
