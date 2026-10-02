const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const validate = require('../middleware/validate');
const authMiddleware = require('../middleware/auth');
const { codeExecutionSchema } = require('../schemas');
const config = require('../config');
const { docker, ensureImage, listeningPorts, publishedPorts } = require('../lib/docker');
const { materialize } = require('../lib/workspace');
const { shQuote } = require('../lib/paths');
const { previewPath } = require('../lib/preview');

const router = express.Router();
router.use(authMiddleware);

// One Docker image per language. Images are pulled automatically on first use.
const IMAGES = {
  javascript: 'node:20-alpine',
  typescript: 'node:20-alpine',
  python: 'python:3.12-alpine',
  java: 'eclipse-temurin:21-jdk-alpine',
  c: 'gcc:13-bookworm',
  cpp: 'gcc:13-bookworm',
  csharp: 'mcr.microsoft.com/dotnet/sdk:8.0-alpine',
  go: 'golang:1.22-alpine',
  rust: 'rust:1.78-slim',
  ruby: 'ruby:3.3-alpine',
  php: 'php:8.3-cli-alpine',
  bash: 'bash:5.2',
  perl: 'perl:5.38-slim',
  lua: 'akorn/lua:5.4-alpine',
  r: 'r-base:4.3.3',
  html: 'python:3.12-alpine',
};
// Languages that may need the network (package installs, dev servers).
const NETWORKED = new Set(['javascript', 'typescript', 'python', 'html', 'csharp', 'go', 'ruby', 'php']);
const PORTS = [3000, 5000, 5173, 8000, 8080];
const MAX_RUNTIME_MS = 10 * 60 * 1000;

// Shell command run inside /sandbox. `dir` is the file's folder, `file` its name (both relative).
function buildCmd(language, dir, file, hasPkg, hasReqs) {
  const f = shQuote(file);
  const cd = `cd /sandbox/${dir ? shQuote(dir) : ''}`;
  const base = file.replace(/\.[^.]+$/, '');
  switch (language) {
    case 'javascript': return `${hasPkg ? 'cd /sandbox && npm install --no-audit --no-fund --loglevel=error && ' : ''}${cd} && node ${f}`;
    case 'typescript': return `${hasPkg ? 'cd /sandbox && npm install --no-audit --no-fund --loglevel=error && ' : ''}${cd} && npx -y tsx ${f}`;
    case 'python': return `${hasReqs ? 'cd /sandbox && pip install -q -r requirements.txt && ' : ''}${cd} && python3 -u ${f}`;
    case 'java': return `${cd} && javac ${f} && java ${shQuote(base)}`;
    case 'c': return `${cd} && gcc ${f} -o /tmp/out -lm && /tmp/out`;
    case 'cpp': return `${cd} && g++ ${f} -o /tmp/out && /tmp/out`;
    case 'csharp': return `mkdir -p /tmp/app && cd /tmp/app && dotnet new console -o . --force >/dev/null 2>&1 && cp /sandbox/${dir ? shQuote(dir) + '/' : ''}${f} Program.cs && dotnet run`;
    case 'go': return `${cd} && go run ${f}`;
    case 'rust': return `${cd} && rustc ${f} -o /tmp/out && /tmp/out`;
    case 'ruby': return `${cd} && ruby ${f}`;
    case 'php': return `${cd} && php ${f}`;
    case 'bash': return `${cd} && bash ${f}`;
    case 'perl': return `${cd} && perl ${f}`;
    case 'lua': return `${cd} && lua ${f}`;
    case 'r': return `${cd} && Rscript ${f}`;
    case 'html': return `${cd} && echo "Serving ${dir || '.'} on port 8080" && python3 -m http.server 8080 --bind 0.0.0.0`;
    default: return null;
  }
}

// socketId -> { stream, container } so the client can type into a running program.
const running = new Map();

function ownedSocket(io, socketId, userId) {
  const s = socketId && io?.sockets.sockets.get(socketId);
  return s && s.data.userId === userId ? s : null;
}

async function removeUserSandboxes(userId) {
  const existing = await docker.listContainers({ all: true, filters: { label: ['orbit.kind=sandbox', `orbit.user=${userId}`] } }).catch(() => []);
  await Promise.all(existing.map(c => docker.getContainer(c.Id).remove({ force: true }).catch(() => {})));
}

router.post('/', validate(codeExecutionSchema), async (req, res) => {
  const { code, language, fileName, filePath = '', projectFiles, socketId } = req.body;
  const io = req.app.get('io');
  const socket = ownedSocket(io, socketId, req.userId);
  const emit = (event, payload) => socket?.emit(event, payload);
  const image = IMAGES[language];
  if (!image) return res.status(400).json({ error: `No runner for "${language}" yet.` });

  const dir = path.join(config.sandboxRoot, crypto.randomUUID());
  const cleanupDir = () => fs.rm(dir, { recursive: true, force: true }, () => {});
  try {
    if (Array.isArray(projectFiles) && projectFiles.length) {
      await materialize(dir, projectFiles);
    } else {
      await materialize(dir, [{ name: fileName, path: filePath, content: code || '' }]);
    }
    const hasPkg = fs.existsSync(path.join(dir, 'package.json'));
    const hasReqs = fs.existsSync(path.join(dir, 'requirements.txt'));
    const cmd = buildCmd(language, filePath, fileName, hasPkg, hasReqs);

    await removeUserSandboxes(req.userId);
    await ensureImage(image, msg => emit('sandbox-output', `\x1b[36m${msg}\x1b[0m\r\n`));

    const container = await docker.createContainer({
      Image: image,
      Cmd: ['sh', '-c', cmd],
      WorkingDir: '/sandbox',
      Labels: { 'orbit.kind': 'sandbox', 'orbit.user': req.userId },
      Tty: true,
      OpenStdin: true,
      StdinOnce: false,
      Env: ['TERM=xterm-256color', 'HOST=0.0.0.0', 'PYTHONUNBUFFERED=1'],
      ExposedPorts: Object.fromEntries(PORTS.map(p => [`${p}/tcp`, {}])),
      HostConfig: {
        Binds: [`${dir}:/sandbox:rw`],
        Memory: 512 * 1024 * 1024,
        NanoCpus: 1e9,
        PidsLimit: 256,
        SecurityOpt: ['no-new-privileges'],
        AutoRemove: true,
        NetworkMode: NETWORKED.has(language) ? 'bridge' : 'none',
        PortBindings: NETWORKED.has(language)
          ? Object.fromEntries(PORTS.map(p => [`${p}/tcp`, [{ HostIp: config.previewHost, HostPort: '0' }]]))
          : {},
      },
    });

    const stream = await container.attach({ stream: true, stdin: true, stdout: true, stderr: true, hijack: true });
    const decoder = new StringDecoder('utf8');
    stream.on('data', chunk => emit('sandbox-output', decoder.write(chunk)));
    if (socketId) running.set(socketId, { stream, container });

    await container.start();
    const mapped = publishedPorts(await container.inspect());
    res.json({ containerId: container.id, message: 'Sandbox started' });

    // Tell the client which ports the program is actually listening on, as preview URLs.
    let lastSent = '';
    const portTimer = setInterval(async () => {
      try {
        const listening = await listeningPorts(container);
        const previews = {};
        for (const p of listening) {
          const hostPort = mapped[`${p}/tcp`];
          if (hostPort) previews[p] = previewPath(hostPort, req.userId);
        }
        const key = Object.keys(previews).sort().join(',');
        if (key && key !== lastSent) { lastSent = key; emit('sandbox-ports', previews); }
      } catch { clearInterval(portTimer); }
    }, 2000);

    const killTimer = setTimeout(() => {
      emit('sandbox-output', '\r\n\x1b[33mSandbox reached the 10 minute limit and was stopped.\x1b[0m\r\n');
      container.kill().catch(() => {});
    }, MAX_RUNTIME_MS);

    container.wait()
      .then(r => emit('sandbox-exit', { code: r.StatusCode }))
      .catch(err => emit('sandbox-exit', { error: err.message }))
      .finally(() => {
        clearInterval(portTimer);
        clearTimeout(killTimer);
        if (running.get(socketId)?.container === container) running.delete(socketId);
        cleanupDir();
      });
  } catch (err) {
    console.error('Sandbox run error:', err.message);
    cleanupDir();
    if (!res.headersSent) res.status(500).json({ error: 'Execution failed: ' + err.message });
  }
});

router.post('/stop', async (req, res) => {
  const { containerId } = req.body || {};
  if (!containerId) return res.status(400).json({ error: 'Missing containerId' });
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect().catch(() => null);
    if (!info) return res.json({ success: true }); // already gone
    if (info.Config.Labels?.['orbit.user'] !== req.userId) return res.status(404).json({ error: 'Not found' });
    await container.kill().catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket handlers for interacting with the running program (stdin + resize).
function attachSandboxIO(socket) {
  socket.on('sandbox-input', (data) => {
    if (typeof data === 'string') running.get(socket.id)?.stream.write(data);
  });
  socket.on('sandbox-resize', ({ cols, rows } = {}) => {
    const r = running.get(socket.id);
    if (r && cols > 0 && rows > 0) r.container.resize({ h: rows, w: cols }).catch(() => {});
  });
  socket.on('disconnect', () => {
    const r = running.get(socket.id);
    if (r) { running.delete(socket.id); r.container.kill().catch(() => {}); }
  });
}

module.exports = router;
module.exports.attachSandboxIO = attachSandboxIO;
module.exports.IMAGES = IMAGES;
module.exports.buildCmd = buildCmd;
