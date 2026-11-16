/** Decides who may open the LilBot socket. The socket can run tools as the user, so this matters. */

/** `extraHosts` is a comma-separated list of `host:port` names the server is reached under, such
 *  as its tailnet name. Local addresses on `port` are always allowed. */
export function allowedHosts(port: number, extraHosts: string | undefined): Set<string> {
  const extra = (extraHosts ?? '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
  return new Set([...extra, `127.0.0.1:${port}`, `localhost:${port}`])
}

/** The Host must be one we serve under: a page on another domain that is pointed at this machine's
 *  address (DNS rebinding) sends its own domain as Host. And when a browser sends an Origin it must
 *  be that same host, so another site cannot use the socket. Non-browser clients send no Origin. */
export function socketAllowed(request: Request, hosts: Set<string>): boolean {
  const host = request.headers.get('host')?.toLowerCase()
  if (!host || !hosts.has(host)) return false
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host.toLowerCase() === host
  } catch {
    return false
  }
}
