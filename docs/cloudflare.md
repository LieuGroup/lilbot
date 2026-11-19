# Cloudflare: public door and Access hostname

How LilBot's two public names are deployed on the leader. What each listener accepts is in `AGENTS.md` under
"Listeners and trust boundaries"; never print, log or commit anything named here as a credential.

## Shared tunnel

- Zone `lilgroup.studio` (Cloudflare Free). Tunnel `lilbot-connect` with its own connector and credentials, separate
  from T3 Code's tunnel and the hosting server.
- `~/.cloudflared/lilbot/config.yml` holds both ingress rules; the tunnel credentials JSON sits beside it (0600).
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
- Roll back the app hostname only: remove its ingress rule and restart `lilbot-tunnel.service` (the helper door keeps
  working); optionally delete the DNS name and the `access.conf` drop-in, then `systemctl --user daemon-reload` and
  restart `lilbot.service`.
