# Cloudflare: public door and Access hostname

How LilBot's two public names are deployed on the leader. What each listener accepts is in `AGENTS.md` under
"Listeners and trust boundaries"; never print, log or commit anything named here as a credential.

## Shared tunnel

- Zone `lilgroup.studio` (Cloudflare Free). Tunnel `lilbot-connect` with its own connector and credentials, separate
  from T3 Code's tunnel and the hosting server.
- `~/.cloudflared/lilbot/config.yml` holds the ingress rules; the tunnel credentials JSON sits beside it (0600).
- `cloudflared` 2026.10.4 in `~/.local/bin`, run by the user unit `lilbot-tunnel.service` (`--no-autoupdate`).
- `~/.cloudflared/cert.pem` (0600, zone `lilgroup.studio`, kept on purpose with Oscar's approval) lets agents manage
  LilBot's own DNS names and tunnels with `cloudflared tunnel route dns ...` without him. Touch only LilBot's own
  tunnels and names; the account holds others.
- Stopping `lilbot-tunnel.service` closes both public names at once. The tailnet address is unaffected.

## Helper door: `lilbot-connect.lilgroup.studio`

- The ingress rule routes only `^/helper/(register|connect)$` on that hostname to `http://127.0.0.1:3372`; everything
  else gets 404 at the edge.
- The door is enabled by `~/.config/systemd/user/lilbot.service.d/public-door.conf` (`LILBOT_PUBLIC_ENABLED=1`,
  `LILBOT_PUBLIC_PORT=3372`).
- Check from outside: every path except the two helper paths returns 404; `/helper/connect` without a valid key
  returns 403.
- Roll back: `systemctl --user disable --now lilbot-tunnel.service` (hostname unreachable at once). To also close the
  door, delete the drop-in, `systemctl --user daemon-reload` and restart `lilbot.service`. The private app is
  unaffected either way.

## Webhook route on the helper door (not applied yet)

LilBot answers `POST /hook/<address>` on the helper door (AGENTS.md, Webhooks). The tunnel does not route it yet: the
orchestrator adds the rule below after a separate security review. Agents building LilBot never edit
`~/.cloudflared/lilbot/config.yml` or restart `lilbot-tunnel.service`.

- The address is `/hook/` and exactly 64 base64url characters. Add this rule directly below the helper rule, on the
  same hostname and service, so nothing else under `/hook/` reaches the door:

  ```yaml
    - hostname: lilbot-connect.lilgroup.studio
      path: ^/hook/[A-Za-z0-9_-]{64}$
      service: http://127.0.0.1:3372
  ```

- Validate before restarting: `cloudflared tunnel --config ~/.cloudflared/lilbot/config.yml ingress validate`, and
  `cloudflared tunnel --config ~/.cloudflared/lilbot/config.yml ingress rule https://lilbot-connect.lilgroup.studio/hook/<64 characters>`
  names the new rule while `/hook/short`, `/hook/<65 characters>` and `/hook/<64>/x` fall to `http_status:404`.
- The door itself needs nothing new: `LILBOT_PUBLIC_ENABLED=1` and `LILBOT_HELPER_URL` (the helper door origin) are
  already set; webhook addresses are built from `LILBOT_HELPER_URL`.
- Check from outside after the restart (no real bot is involved):
  - `POST /hook/<64 random characters>` returns 404 `Not found`, byte for byte the same as `POST /nothing`;
  - `GET` on the same path returns that 404 too; any query string or `Origin` header returns 403;
  - `/hook/<63 characters>` and `/hook/<65 characters>` get the edge's 404 (the door never sees them);
  - a body over 256 KiB returns 413; more than 120 requests a minute from one address return 429;
  - `/helper/register` and `/helper/connect` behave as before.
- Real senders: Bot Fight Mode, a WAF managed challenge or "Under attack" mode on the zone would answer GitHub's or
  Stripe's servers with a challenge page they cannot pass. Before the first real webhook, check in the dashboard
  (read-only) that none applies to `lilbot-connect.lilgroup.studio/hook/*`; changing zone settings is Oscar's call.
- Roll back: remove the rule and restart `lilbot-tunnel.service`; every address is unreachable at once and the helper
  paths keep working. To refuse webhooks at the door too, pause or delete them in the app.

## App: `https://bot.lilgroup.studio`

- Its own ingress rule, hostname `bot.lilgroup.studio` to `http://127.0.0.1:3373` (the Access listener only).
- A Cloudflare Access self-hosted application on that hostname allows exactly one email (the owner's, kept out of
  this repo), signs in with the one-time email code and lasts 24 hours. It was created before the DNS name, so the
  hostname was never reachable without the sign-in.
- The listener settings (`LILBOT_ACCESS_ENABLED=1`, `LILBOT_ACCESS_PORT=3373`, `LILBOT_ACCESS_HOST`,
  `LILBOT_ACCESS_TEAM`, `LILBOT_ACCESS_AUD`, `LILBOT_ACCESS_EMAIL`) are in the 0600 drop-in
  `~/.config/systemd/user/lilbot.service.d/access.conf`, never in the repo.
- Check from outside: every path, including `/ws`, `/api/*`, `/engine/*` and `/helper/*`, answers with a redirect to
  the Access sign-in; a forged token sent through the tunnel is redirected too, and sent straight to the listener
  gets 403.
- Local test certs: `LILBOT_ACCESS_TEST_CERTS_URL` exists only for `check:access` and `check:connections` (HTTP on
  `127.0.0.1`, all three isolation directories, and `LILBOT_BOT_IDS` exactly `isolation-access-check`, or in development
  only `dev-` profiles). Production refuses it (`*_TEST_*`). Never set it in deployment.
- Roll back the app hostname only: remove its ingress rule and restart `lilbot-tunnel.service` (the helper door keeps
  working); optionally delete the DNS name and the `access.conf` drop-in, then `systemctl --user daemon-reload` and
  restart `lilbot.service`.
