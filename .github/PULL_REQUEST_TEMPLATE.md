## Summary

<!-- Describe what shipped, grouped by theme. Link related issues if any. -->

## Verification

- `bun run verify` passed (lint, typecheck, knip, file size and AGENTS.md checks, tests, web build)
- <!-- Note any live checks or browser checks run, or why none applied -->

## Growth report delta

<!-- Copy or state the source lines and web first-load bundle delta from `bun run verify` -->

- Source lines:
- Web first load (gzip -9):

## Checklist

See [AGENTS.md](../AGENTS.md#before-you-open-a-pr) for the full rules.

- [ ] No dead code (unused files, exports, parameters, branches, or settings)
- [ ] No duplicate helpers, pass-through layers, or single-caller options
- [ ] No comments that restate the code or tell history
- [ ] Tests cover new logic without asserting nothing real or duplicating another test
- [ ] Every source file stays under 200 lines (`scripts/size-exceptions.json` did not grow) and `AGENTS.md` stays within its verify limits
- [ ] `bun run verify` passes cleanly
- [ ] No secrets, credentials, personal emails, hostnames, or local paths in the diff
