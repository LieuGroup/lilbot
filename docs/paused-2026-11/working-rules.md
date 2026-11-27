# Working rules for a resuming agent

Back to [the pause record](../paused-2026-11.md). These held for every agent working on LilBot up to the pause and are
not stated in `AGENTS.md`. They come from the owner's own rulings.

## Engine and models

- Hermes is the only engine. No work on any other engine.
- Never call a Google model (Gemini, including Neon) in tests, live checks or proofs.
- Live checks use an Anthropic or OpenAI model, spaced out, and stop at once on any HTTP 403 or account message.

## Live checks

- Live checks never overlap, and another agent may stop the dev gateway between commands. Run each one under the lock:
  `flock ~/lilbot-dev/live-check.lock bash -c 'bun run dev:setup && bun run check:<name>'`.
- A test bot runs as the owner's user with full access. Every scenario must be answerable from fixtures inside the
  temporary bot's own workspace, and say where they are. The check fails if a tool call reaches outside the
  development area or that workspace; if a test bot reads anything else, report the path, never the contents.
- A test must never be able to drive a real outside tool of the owner's (his coding tools, other bot apps, his
  accounts). When a trial gives a bot instructions naming such a tool, give it a copy where the tool's command is a
  harmless stand-in, and check afterwards that nothing was created outside the worktree and the dev home.
- Keep model replies in tests short; long single replies fail with "incomplete response".

## Proof

- A result reported as proof (a live check, a simulator pass, a recording, a benchmark) must come from the exact
  pushed commit: check it out clean, build it from scratch the normal way, and record the commit id printed at build
  time and the commands used. Never patch a built artefact, reuse an older generated project, or test an uncommitted
  state.
- Re-embedding a new JavaScript bundle into an existing native build counts only when the file list between the two
  commits shows no dependency, plugin, configuration or native change.
- iPhone builds and simulator runs happen on a Mac with Xcode; edit and commit on the Linux machine, push, and build
  the pushed branch there.

## iPhone screens: portrait and landscape

Every iPhone screen is designed for and proven in both portrait and landscape: ordinary iPhone, folded Duo and
unfolded Duo (iPad where the screen has an iPad layout). Proof pictures for a screen change include landscape at
default and at the largest text size, with the keyboard up where the screen has a text field. The Duo rules hold in
both orientations. A reviewer does not pass an iPhone screen change without them.

## Designs and reports

- The owner reviews designs and screen changes from pictures, not code: show him the frames, at the sizes and
  orientations above.
- Reports are read by someone who does not read code: lead with the outcome and what needs a decision, and say
  plainly what could not be verified.

## Public repository

This repository is public. No personal names (say "the owner"), email addresses, host names, network addresses,
machine ids, tokens or log excerpts naming people go into a file, commit message, PR or issue.

## Issues on hold

The owner put these on hold; leave them untouched: #58, #62, #63, #64, #70, #113, #128.
