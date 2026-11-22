# Security Policy

## Reporting a vulnerability

Report security vulnerabilities privately through GitHub's private vulnerability reporting on this repository:

- Open the **Security** tab on GitHub and choose **Report a vulnerability**, or go directly to [New security advisory](https://github.com/lieugroup/lilbot/security/advisories/new).

Do not open a public GitHub issue for suspected security vulnerabilities, and do not include live secrets, tokens, or credentials in your report.

## Scope

LilBot is a single-user self-hosted server that binds to loopback (`127.0.0.1`) and separates traffic across three listeners with distinct trust boundaries. Security reports are especially relevant for:

- **Private app listener (`LILBOT_PORT`):** Host/Origin WebSocket and HTTP guard (`server/http/socket-guard.ts`), refusal of Cloudflare tunnel headers (`cf-connecting-ip`, `cf-ray`, `cdn-loop`), and loopback `/engine/*` API and MCP endpoints authenticated by per-bot HMAC credentials.
- **Helper door (`LILBOT_PUBLIC_ENABLED=1`, `LILBOT_PUBLIC_PORT`):** Optional separate listener restricted to remote computer helper registration/WebSocket frames and HMAC-addressed signed webhooks (`POST /hook/<address>`). It must never expose the web app, browser WebSocket, file downloads, or engine endpoints.
- **Cloudflare Access listener (`LILBOT_ACCESS_ENABLED=1`, `LILBOT_ACCESS_PORT`):** Optional separate listener enforcing RS256 Cloudflare Access JWT verification (issuer, audience, expiry/nbf, and configured email) on every HTTP request and WebSocket handshake, plus the opt-in MCP OAuth callback route (`LILBOT_ACCESS_CALLBACK_ENABLED=1`).
- **Isolation and data boundaries:** Workspace, library, chat attachment, and thread file path/symlink safety (`O_NOFOLLOW`), webhook capability enforcement and payload fencing, MCP OAuth/SSRF checks, memory safety filters, and secret handling.

For full architectural details of each boundary and the list of sensitive files, see [AGENTS.md — Listeners and trust boundaries](AGENTS.md#listeners-and-trust-boundaries), [AGENTS.md — Secrets](AGENTS.md#secrets), and the area docs in [`docs/`](docs/).
