# Library and chat attachments

Short summaries are in `AGENTS.md` under "Library and chat attachments"; screen specs and behaviour are in
[screens.md](screens.md).

## Library (`server/library/`)

`server/library/` owns delivered items (`shared/library-schema.ts`).

- A bot delivers with `lilbot_give_file` (path, title, `requestId`; LilBot's MCP server, #113), which needs a title and
  the conversation the call came from. That comes from LilBot's records of the call (`giveFrom` in `app-work.ts`: the
  call matched to its own tool start, as for `lilbot_delegate` and `lilbot_work`; refused when none is seen), never from
  an argument: a routine run's two session aliases and a session the engine continued after compressing it resolve to
  the persisted run id of that bot (`workSessions`), a webhook run's session is recorded as the conversation, and a
  lineage that cannot be read refuses and gives nothing. Each call is logged in `system_changes`. The adapter's
  `give_file` ended with adapter 0.12.0; the engine API's `/engine/library/give` stays for sessions that loaded an older
  adapter.
- Items point to workspace files, never copies; only explicitly given files appear. Kinds: media (image/audio/video
  MIME), page (.md/.html/.htm), file. Size limit in `library-files.ts`.
- `library.list` is newest first, filterable by `kinds`, with each item's missing status, MIME type (from its name) and
  download URL. `library.content` returns the same URL; `library.workspace` lists a folder separately (names and sizes:
  a file nobody gave cannot be downloaded). The download sends the file's own name.
- Reads use Linux descriptor-relative opens with no-follow flags; workspace-root symlinks and nonregular files are
  refused.
- Hermes exposes no outgoing attachment manifest, so assistant files are not collected automatically; tool image
  previews are not deliveries.

## Shown files (`server/shown/`, #317)

- Off by default: `lilbot_show` is offered only with `LILBOT_SHOW_ENABLED=1` (`isShowEnabled`), the same switch pattern
  as `LILBOT_PROMPT_OWNERSHIP` and `LILBOT_T3_ENABLED`. With it off the tool is not listed at all; the route and the
  item kind exist so a reply shown while it was on still draws.
- `lilbot_show({ path, caption?, requestId })` shows an image (PNG, JPEG, GIF, WebP), video (MP4, M4V, MOV) or HTML page
  (.html/.htm), by extension. The conversation comes from the call's own tool start (as `lilbot_give_file`); a session
  Oscar does not see (routine, webhook, check, exchange) is refused. Limits (Oscar, 2026-11-26): 4 per reply (since
  Oscar's latest message or the turn's start), image 20 MB, HTML 2 MB, video 50 MB; caption one line of at most 120
  characters, cut at a word. Every refusal returns its reason to the bot and places nothing.
- `shown_files` keeps the path inside the bot's folder, never a copy. The item is written to `history_items` as
  `shown:<id>` at the call's time (so it sits between the reply's words after the engine's own import), published
  live as a `shown` chat event, and searched by caption and file name.
- The engine's own row for the `lilbot_show` call is never drawn or kept: `isShowTool` filters it live
  (`chat-state.ts`), in the journal rebuild (`history-tail.ts`) and on import (`history-store.ts`).
- `/api/shown/<bot>/<id>` re-opens the saved path through `openWorkspaceFile` (no links, inside the folder), refuses a
  file grown past its kind's limit (413) or gone (404), and answers one `bytes=` range with 206 so video seeks. Same
  Host/Origin guard and download headers (`Content-Disposition: attachment`, `CSP: sandbox`) as the Library route; an
  HTML page is never rendered from it on LilBot's origin.
- Routine and webhook transcripts drop `shown` items. A deleted bot's rows go with it.

## Chat attachments (`server/attachments/`)

`server/attachments/` owns incoming files and message associations; the screens are in `web/src/attachments/`.

- Three ways in, several files at once: the composer's plus button, pasting files (pasted text stays text) and
  dropping on the conversation column. Uploads in progress disable Send; a message may be files only. Refused files
  (with a reason) and files over the per-message limit never block sending the rest. The client counts staged,
  not-refused files against the limit before `attachments.prepare`; the server enforces it again on send.
- File names are untrusted: always plain text (React text nodes, `alt`, `title`, `download`), never HTML, and never
  part of a path. Staged files belong to one bot: switching bots empties the composer and ignores late uploads.
- Upload: `attachments.prepare` reserves files in order, then the raw bytes are PUT (not multipart) to each
  `uploadUrl`. Removing an unsent chip does not delete its workspace file. An interrupted upload can be retried; a
  partial file that survived a crash is refused, not overwritten, and the client prepares a new file. No byte-offset
  resume.
- `chat.send` with files needs a client UUID `messageId` (`newMessageId`, which also works on plain-HTTP pages). Every
  attachment must be ready and belong to the open chat's bot. Retries use the same id, text and files (engine
  admission idempotency); a changed payload is refused. The send answer and the `user.message` event are reconciled by
  `messageId` (`withSentMessage` in `chat/chat-state.ts`), never a second bubble, queued sends included.
- The association is saved before submission. A unique display-only marker in the engine's stored text identifies the
  exact row (allowing the engine's prepended image analysis and appended image references); the HTTP edge swaps it for
  the original text and metadata. Reopening reads SQLite and never resubmits; an uncertain send is retried only by
  explicit client action.
- Image support is `supported | unsupported | unknown`, kept as it was at send time. Show "model cannot see images"
  only for `unsupported` with a positive count. Hermes declares no vision capability, so it reports `unknown`, never
  a guess from model names.
- Storage: streamed to generated names in the bot's `attachments/` folder through no-follow, exclusive-create file
  descriptors; the stream enforces the size cap; directory swaps are refused; partial writes are removed; reads
  verify SHA-256 before returning bytes. MIME is normalised; PNG/JPEG/GIF/WebP magic decides image delivery and other
  images are refused with `unsupported_image`.
- Non-image files reach the bot as workspace references; the note treats file names and contents as data, not Oscar's
  instructions.
