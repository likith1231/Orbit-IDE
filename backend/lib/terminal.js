// Interactive terminals over socket.io.
//
// Backends, picked per TERMINAL_MODE (default "auto"):
//   docker — one long-lived container per project with the workspace mounted at /workspace.
//            Each terminal tab is a `docker exec` with a TTY, so no node-pty is needed and
//            users never get a shell on the host. This is what a cloud deployment should use.
//   local  — a shell on the backend host, in the project's workspace directory. Uses node-pty
//            when it is installed, then `script` (Linux/macOS) to get a real pty, then plain
//            pipes with a tiny line editor as a last resort (e.g. Windows without node-pty).
const os = require('os');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { StringDecoder } = require('string_decoder');
const prisma = require('../db');
const config = require('../config');
const workspace = require('./workspace');
const { docker, dockerAvailable, ensureImage } = require('./docker');

const LABEL = 'orbit.kind';
const PREVIEW_PORTS = [3000, 4200, 5000, 5173, 8000, 8080];
const MAX_SESSIONS_PER_SOCKET = 6;
const PS1 = '\\[\\e[1;32m\\]orbit\\[\\e[0m\\]:\\[\\e[1;34m\\]\\w\\[\\e[0m\\]\\$ ';

let ptyModule; // undefined = not tried, null = unavailable
function loadPty() {
  if (ptyModule === undefined) {
    try { ptyModule = require('node-pty'); } catch { ptyModule = null; }
  }
  return ptyModule;
}

function hasCommand(cmd) {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

async function resolveMode() {
  const mode = config.terminalMode;
  if (mode === 'off') return 'off';
  if (mode === 'docker') return 'docker';
  if (mode === 'local') return 'local';
  if (await dockerAvailable()) return 'docker';
  return config.isProd ? 'off' : 'local';
}

// ───────────────────────── Docker backend ─────────────────────────

const containerUsers = new Map(); // containerId -> active session count
const idleTimers = new Map();
const starting = new Map(); // projectId -> Promise<container>

const containerName = (projectId) => `orbit-term-${projectId}`;

let fallbackUntil = 0;
async function terminalImage(notify) {
  if (Date.now() < fallbackUntil) {
    await ensureImage(config.terminalFallbackImage, notify);
    return config.terminalFallbackImage;
  }
  try {
    await ensureImage(config.terminalImage, notify);
    return config.terminalImage;
  } catch (err) {
    if (config.terminalImage === config.terminalFallbackImage) throw err;
    if (!fallbackUntil) {
      fallbackUntil = Date.now() + 10 * 60 * 1000;
      console.warn(`Terminal image ${config.terminalImage} unavailable (${err.message}); using ${config.terminalFallbackImage}. Build it with: docker build -t orbit-terminal:latest -f docker/terminal.Dockerfile docker`);
    }
    fallbackUntil = Date.now() + 10 * 60 * 1000;
    await ensureImage(config.terminalFallbackImage, notify);
    return config.terminalFallbackImage;
  }
}

function containerUser() {
  // Run as the backend's own uid so files created in the terminal stay editable by the backend.
  return typeof process.getuid === 'function' && process.getuid() !== 0
    ? `${process.getuid()}:${process.getgid()}` : undefined;
}

async function getProjectContainer(userId, projectId, notify) {
  if (starting.has(projectId)) return starting.get(projectId);
  const job = (async () => {
    const name = containerName(projectId);
    let container = docker.getContainer(name);
    let info = await container.inspect().catch(() => null);

    if (info && info.Config.Labels?.['orbit.user'] !== userId) {
      throw new Error('Terminal container belongs to another user');
    }
    if (!info) {
      const image = await terminalImage(notify);
      const dir = await workspace.syncToDisk(projectId);
      const user = containerUser();
      container = await docker.createContainer({
        name,
        Image: image,
        Cmd: ['sleep', 'infinity'],
        WorkingDir: '/workspace',
        User: user,
        Env: [`HOME=${user ? '/tmp/home' : '/root'}`, 'TERM=xterm-256color', 'npm_config_update_notifier=false'],
        Labels: { [LABEL]: 'terminal', 'orbit.user': userId, 'orbit.project': projectId },
        ExposedPorts: Object.fromEntries(PREVIEW_PORTS.map(p => [`${p}/tcp`, {}])),
        HostConfig: {
          Binds: [`${dir}:/workspace:rw`],
          Memory: config.terminalMemoryMb * 1024 * 1024,
          NanoCpus: 1e9,
          PidsLimit: 512,
          Init: true,
          SecurityOpt: ['no-new-privileges'],
          CapDrop: ['NET_RAW', 'MKNOD', 'AUDIT_WRITE'],
          PortBindings: Object.fromEntries(PREVIEW_PORTS.map(p => [`${p}/tcp`, [{ HostIp: config.previewHost, HostPort: '0' }]])),
        },
      });
      info = await container.inspect();
    } else {
      await workspace.syncToDisk(projectId);
    }
    if (!info.State.Running) await container.start();
    return container;
  })().finally(() => starting.delete(projectId));
  starting.set(projectId, job);
  return job;
}

function retainContainer(container) {
  clearTimeout(idleTimers.get(container.id));
  idleTimers.delete(container.id);
  containerUsers.set(container.id, (containerUsers.get(container.id) || 0) + 1);
}

function releaseContainer(container) {
  const n = (containerUsers.get(container.id) || 1) - 1;
  containerUsers.set(container.id, n);
  if (n > 0) return;
  // Keep the container warm for a while so reopening a tab is instant and
  // background dev servers keep running; then stop it to free memory.
  idleTimers.set(container.id, setTimeout(async () => {
    idleTimers.delete(container.id);
    if ((containerUsers.get(container.id) || 0) > 0) return;
    containerUsers.delete(container.id);
    await container.remove({ force: true }).catch(() => {});
  }, config.terminalIdleMinutes * 60 * 1000));
}

async function openDockerSession({ userId, projectId, cols, rows, shell, onData, onExit, notify }) {
  const container = await getProjectContainer(userId, projectId, notify);
  const wanted = shell === 'sh' ? 'sh' : 'bash';
  const cmd = wanted === 'bash'
    ? 'if command -v bash >/dev/null 2>&1; then exec bash --norc -i; else exec sh -i; fi'
    : 'exec sh -i';
  const user = containerUser();
  const exec = await container.exec({
    Cmd: ['sh', '-c', `mkdir -p "$HOME" 2>/dev/null; ${cmd}`],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    User: user,
    WorkingDir: '/workspace',
    Env: [`PS1=${PS1}`, 'TERM=xterm-256color', 'COLORTERM=truecolor', `COLUMNS=${cols}`, `LINES=${rows}`],
  });
  const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
  retainContainer(container);

  const decoder = new StringDecoder('utf8');
  let closed = false;
  const finish = async () => {
    if (closed) return;
    closed = true;
    releaseContainer(container);
    const code = await exec.inspect().then(i => i.ExitCode).catch(() => null);
    onExit(code);
  };
  stream.on('data', chunk => onData(decoder.write(chunk)));
  stream.on('end', finish);
  stream.on('close', finish);
  stream.on('error', finish);
  exec.resize({ h: rows, w: cols }).catch(() => {});

  return {
    backend: 'docker',
    shell: wanted,
    write: (d) => { if (!closed) stream.write(d); },
    resize: (c, r) => exec.resize({ h: r, w: c }).catch(() => {}),
    kill: () => { stream.end(); stream.destroy(); finish(); },
  };
}

// ───────────────────────── Local backend ─────────────────────────

function localShell(shell) {
  if (process.platform === 'win32') return { file: shell === 'cmd' ? 'cmd.exe' : 'powershell.exe', args: [] };
  if (shell === 'sh' || !hasCommand('bash')) return { file: 'sh', args: ['-i'] };
  return { file: 'bash', args: ['-i'] };
}

async function openLocalSession({ projectId, cols, rows, shell, onData, onExit }) {
  const cwd = await workspace.syncToDisk(projectId);
  const env = { ...process.env, TERM: 'xterm-256color', PS1 };
  const { file, args } = localShell(shell);
  const pty = loadPty();

  if (pty) {
    const p = pty.spawn(file, process.platform === 'win32' ? [] : args.filter(a => a !== '-i'), { name: 'xterm-256color', cols, rows, cwd, env });
    p.onData(onData);
    p.onExit(({ exitCode }) => onExit(exitCode));
    return { backend: 'node-pty', shell: file, write: d => p.write(d), resize: (c, r) => { try { p.resize(c, r); } catch {} }, kill: () => p.kill() };
  }

  const decoder = new StringDecoder('utf8');

  // `script` allocates a real pty for us on Linux and macOS.
  if (process.platform !== 'win32' && hasCommand('script')) {
    const scriptArgs = process.platform === 'darwin'
      ? ['-q', '/dev/null', file, ...args]
      : ['-qfc', [file, ...args].join(' '), '/dev/null'];
    const child = spawn('script', scriptArgs, { cwd, env: { ...env, COLUMNS: String(cols), LINES: String(rows) } });
    child.stdout.on('data', d => onData(decoder.write(d)));
    child.stderr.on('data', d => onData(decoder.write(d)));
    child.on('exit', code => onExit(code));
    child.on('error', err => { onData(`\r\n${err.message}\r\n`); onExit(1); });
    // Programs read the size from the tty; set it once the shell is up.
    setTimeout(() => child.stdin.writable && child.stdin.write(`stty cols ${cols} rows ${rows} 2>/dev/null; clear\n`), 150);
    return {
      backend: 'script',
      shell: file,
      write: d => child.stdin.writable && child.stdin.write(d),
      resize: (c, r) => child.stdin.writable && child.stdin.write(`stty cols ${c} rows ${r} 2>/dev/null\n`),
      kill: () => child.kill(),
    };
  }

  // Last resort: plain pipes. The shell has no tty, so we echo keystrokes and
  // handle backspace/enter ourselves. Good enough for running commands.
  const pipeFile = process.platform === 'win32' ? 'cmd.exe' : file;
  const child = spawn(pipeFile, process.platform === 'win32' ? ['/Q'] : args, { cwd, env });
  const out = d => onData(decoder.write(d).replace(/\r?\n/g, '\r\n'));
  child.stdout.on('data', out);
  child.stderr.on('data', out);
  child.on('exit', code => onExit(code));
  child.on('error', err => { onData(`\r\n${err.message}\r\n`); onExit(1); });
  let line = '';
  onData('\x1b[33m(limited terminal: install node-pty for full TTY support)\x1b[0m\r\n');
  return {
    backend: 'pipe',
    shell: pipeFile,
    write: (data) => {
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') { onData('\r\n'); child.stdin.write(line + (process.platform === 'win32' ? '\r\n' : '\n')); line = ''; }
        else if (ch === '\x7f' || ch === '\b') { if (line) { line = line.slice(0, -1); onData('\b \b'); } }
        else if (ch === '\x03') { line = ''; onData('^C\r\n'); try { child.kill('SIGINT'); } catch {} }
        else if (ch >= ' ') { line += ch; onData(ch); }
      }
    },
    resize: () => {},
    kill: () => child.kill(),
  };
}

// ───────────────────────── socket wiring ─────────────────────────

async function ownsProject(userId, projectId) {
  if (typeof projectId !== 'string') return false;
  return !!(await prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true } }));
}

const clamp = (n, lo, hi, dflt) => (Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : dflt);

function attachTerminals(io, socket) {
  const sessions = new Map(); // termId -> { session, projectId }
  const userId = socket.data.userId;
  const emitData = (termId) => (data) => socket.emit('term:data', { termId, data });

  const closeSession = (termId) => {
    const s = sessions.get(termId);
    if (!s) return;
    sessions.delete(termId);
    workspace.stopScanner(s.projectId, s.onFilesChanged);
    try { s.session?.kill(); } catch {}
  };

  socket.on('term:open', async ({ termId, projectId, cols, rows, shell } = {}) => {
    if (typeof termId !== 'string' || termId.length > 64) return;
    closeSession(termId);
    if (sessions.size >= MAX_SESSIONS_PER_SOCKET) {
      return socket.emit('term:data', { termId, data: '\r\n\x1b[31mToo many open terminals.\x1b[0m\r\n' });
    }
    if (!(await ownsProject(userId, projectId))) {
      return socket.emit('term:data', { termId, data: '\r\n\x1b[31mProject not found.\x1b[0m\r\n' });
    }
    const mode = await resolveMode();
    if (mode === 'off') {
      return socket.emit('term:data', { termId, data: '\r\n\x1b[31mThe terminal is disabled on this server (Docker is not available).\x1b[0m\r\n' });
    }

    const onFilesChanged = () => io.to(`project:${projectId}`).emit('files-changed', { projectId });
    const entry = { projectId, onFilesChanged, session: null };
    sessions.set(termId, entry);
    socket.join(`project:${projectId}`);
    workspace.startScanner(projectId, onFilesChanged);

    const opts = {
      userId, projectId, shell,
      cols: clamp(cols, 10, 500, 80),
      rows: clamp(rows, 4, 200, 24),
      onData: emitData(termId),
      onExit: (code) => {
        if (sessions.get(termId) !== entry) return;
        socket.emit('term:exit', { termId, code });
        closeSession(termId);
      },
      notify: (msg) => socket.emit('term:data', { termId, data: `\x1b[36m${msg}\x1b[0m\r\n` }),
    };
    try {
      const session = mode === 'docker' ? await openDockerSession(opts) : await openLocalSession(opts);
      if (sessions.get(termId) !== entry) return session.kill(); // closed while starting
      entry.session = session;
      socket.emit('term:ready', { termId, backend: session.backend, shell: session.shell });
    } catch (err) {
      console.error('terminal start failed:', err);
      socket.emit('term:data', { termId, data: `\r\n\x1b[31mCould not start terminal: ${err.message}\x1b[0m\r\n` });
      closeSession(termId);
    }
  });

  socket.on('term:input', ({ termId, data } = {}) => {
    if (typeof data === 'string') sessions.get(termId)?.session?.write(data);
  });
  socket.on('term:resize', ({ termId, cols, rows } = {}) => {
    sessions.get(termId)?.session?.resize(clamp(cols, 10, 500, 80), clamp(rows, 4, 200, 24));
  });
  socket.on('term:close', ({ termId } = {}) => closeSession(termId));
  socket.on('disconnect', () => { for (const id of [...sessions.keys()]) closeSession(id); });
}

// Terminal container for a project, if one is running (used for port previews).
async function findProjectContainer(userId, projectId) {
  const info = await docker.getContainer(containerName(projectId)).inspect().catch(() => null);
  if (!info || info.Config.Labels?.['orbit.user'] !== userId || !info.State.Running) return null;
  return { container: docker.getContainer(info.Id), info };
}

// Containers from a previous run of the server have no session bookkeeping; clear them out.
async function cleanupStaleContainers() {
  if (!(await dockerAvailable())) return;
  const stale = await docker.listContainers({ all: true, filters: { label: [`${LABEL}=terminal`] } }).catch(() => []);
  await Promise.all(stale.map(c => docker.getContainer(c.Id).remove({ force: true }).catch(() => {})));
}

module.exports = { attachTerminals, findProjectContainer, cleanupStaleContainers, resolveMode, PREVIEW_PORTS, ownsProject };
