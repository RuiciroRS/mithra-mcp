// local-guard — keeps the GUI reachable from this machine's own pages only.
//
// Listening on 127.0.0.1 stops other machines, but not other web pages: any site
// open in your browser can open ws://127.0.0.1:<port> (cross-site WebSocket
// hijacking) and, with DNS rebinding, call /api/* under its own hostname. The
// terminal socket spawns claude in your projects, so both are closed here:
//   - Host must name this server on a loopback name (blocks DNS rebinding).
//   - Origin, when a browser sends one, must be this same server (blocks
//     cross-site WebSockets and cross-site POSTs). Non-browser local clients send
//     no Origin and are allowed: they already run on this machine.

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

export function allowedHosts(host, port) {
  const names = new Set(LOOPBACK);
  if (host && host !== '0.0.0.0' && host !== '::') names.add(host.includes(':') ? `[${host}]` : host);
  return new Set([...names].map((n) => `${n}:${port}`.toLowerCase()));
}

export function hostOk(hostHeader, allowed) {
  return typeof hostHeader === 'string' && allowed.has(hostHeader.toLowerCase());
}

export function originOk(originHeader, allowed) {
  if (originHeader === undefined) return true; // not a browser
  try {
    const u = new URL(originHeader);
    return u.protocol === 'http:' && allowed.has(u.host.toLowerCase());
  } catch {
    return false; // "null" (sandboxed iframe, file://) and garbage
  }
}

// Express middleware: Host on every request, Origin on every request a browser tags.
export function guardHttp(allowed) {
  return (req, res, next) => {
    if (!hostOk(req.headers.host, allowed)) return res.status(403).send('forbidden host');
    if (!originOk(req.headers.origin, allowed)) return res.status(403).send('forbidden origin');
    next();
  };
}

// ws verifyClient: same two checks before the upgrade is accepted.
export function guardWs(allowed) {
  return ({ req }) => hostOk(req.headers.host, allowed) && originOk(req.headers.origin, allowed);
}
