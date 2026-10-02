// Reverse proxy for apps running inside sandbox/terminal containers.
//
// Container ports are only published on PREVIEW_HOST (127.0.0.1 by default), so nothing is
// exposed on the VM's public interface. The browser reaches them through
//   <backend>/preview/<signed token>/<path>
// which works over the backend's HTTPS origin (no mixed-content problems) and needs no
// extra firewall rules. The token names the host port and is signed, so it can't be
// pointed somewhere else.
const http = require('http');
const net = require('net');
const jwt = require('jsonwebtoken');
const config = require('../config');

const PREFIX = '/preview/';

function previewPath(hostPort, userId, ttl = '12h') {
  const token = jwt.sign({ p: Number(hostPort), u: userId, k: 'preview' }, config.jwtSecret, { expiresIn: ttl });
  return `${PREFIX}${token}/`;
}

function readToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.k !== 'preview' || !Number.isInteger(payload.p)) return null;
    return payload;
  } catch {
    return null;
  }
}

// "/preview/<token>/rest?x" -> { token, rest: "/rest?x" }
function splitUrl(url) {
  if (!url.startsWith(PREFIX)) return null;
  const after = url.slice(PREFIX.length);
  const slash = after.search(/[/?]/);
  const token = slash === -1 ? after : after.slice(0, slash);
  let rest = slash === -1 ? '/' : after.slice(slash);
  if (rest.startsWith('?')) rest = '/' + rest;
  return { token, rest };
}

function forward(req, res, port, upstreamPath, mount) {
  const headers = { ...req.headers, host: `localhost:${port}` };
  delete headers.authorization;
  delete headers.cookie;
  const upstream = http.request({ host: config.previewHost, port, method: req.method, path: upstreamPath, headers }, (up) => {
    const out = { ...up.headers };
    // Keep redirects inside the preview mount.
    if (out.location && out.location.startsWith('/') && mount) out.location = mount.replace(/\/$/, '') + out.location;
    delete out['x-frame-options'];
    res.writeHead(up.statusCode || 502, out);
    up.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<body style="font-family:sans-serif;padding:2rem;color:#555">Nothing is listening on this port yet. Start your app and refresh.</body>');
    } else res.destroy();
  });
  req.pipe(upstream);
}

function previewMiddleware(req, res, next) {
  const parts = splitUrl(req.originalUrl);
  if (parts) {
    const payload = readToken(parts.token);
    if (!payload) return res.status(403).send('Preview link expired. Re-run your app to get a new one.');
    return forward(req, res, payload.p, parts.rest, `${PREFIX}${parts.token}/`);
  }

  // Apps often reference absolute paths ("/assets/app.js", "/@vite/client") which escape the
  // /preview/<token>/ prefix. Route them back using the Referer of the page that asked.
  if (req.method === 'GET' && !/^\/(api|socket\.io|yjs)(\/|$)/.test(req.path)) {
    try {
      const ref = req.headers.referer && new URL(req.headers.referer);
      const refParts = ref && splitUrl(ref.pathname);
      const payload = refParts && readToken(refParts.token);
      if (payload) return forward(req, res, payload.p, req.originalUrl, `${PREFIX}${refParts.token}/`);
    } catch { /* fall through */ }
  }
  next();
}

// Pass websocket upgrades (e.g. Vite/Next HMR) through to the app. Returns true if handled.
function handlePreviewUpgrade(req, socket, head) {
  const parts = splitUrl(req.url);
  const payload = parts && readToken(parts.token);
  if (!payload) return false;
  const upstream = net.connect(payload.p, config.previewHost, () => {
    const lines = [`${req.method} ${parts.rest} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      if (/^(host|cookie|authorization)$/i.test(name)) continue;
      lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
    }
    lines.push(`Host: localhost:${payload.p}`);
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  return true;
}

module.exports = { previewPath, previewMiddleware, handlePreviewUpgrade };
