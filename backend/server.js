const config = require('./config');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');
const { setupWSConnection } = require('y-websocket/bin/utils');
const prisma = require('./db');

const authMiddleware = require('./middleware/auth');
const { verifyToken } = authMiddleware;
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const chatRoutes = require('./routes/chats');
const runRoutes = require('./routes/run');
const chaosRoutes = require('./routes/chaos');
const gitRoutes = require('./routes/git');
const aiRoutes = require('./routes/ai');
const ai = require('./lib/ai');
const { docker, dockerAvailable } = require('./lib/docker');
const { attachTerminals, cleanupStaleContainers, resolveMode } = require('./lib/terminal');
const { previewMiddleware, handlePreviewUpgrade } = require('./lib/preview');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const corsOptions = {
  origin: config.corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  credentials: true,
};

// App previews are proxied before anything else so their requests aren't touched by our middleware.
app.use(previewMiddleware);

app.use(cors(corsOptions));
app.use(express.json({ limit: '25mb' }));

const limiter = (max, windowMs, error) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error },
});
const generalLimiter = limiter(2000, 15 * 60 * 1000, 'Too many requests, please try again later');
const dockerLimiter = limiter(40, 60 * 1000, 'Too many execution requests, please try again in a minute');

app.get('/api/health', async (req, res) => {
  const [db, dockerOk, terminal] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    dockerAvailable(),
    resolveMode(),
  ]);
  res.status(db ? 200 : 503).json({ ok: db, db, docker: dockerOk, terminal, ai: ai.enabled() });
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', generalLimiter, projectRoutes);
app.use('/api/projects/:projectId/git', generalLimiter, gitRoutes);
app.use('/api/projects/:projectId/chats', generalLimiter, chatRoutes);
app.use('/api/chats', generalLimiter, chatRoutes);
app.use('/api/ai', generalLimiter, aiRoutes);
app.use('/api/run', dockerLimiter, runRoutes);
app.use('/api/chaos', dockerLimiter, chaosRoutes);

// Containers panel: only ever shows / controls the current user's own containers.
const containers = express.Router();
containers.use(authMiddleware);
containers.get('/list', async (req, res) => {
  try {
    const list = await docker.listContainers({ all: true, filters: { label: [`orbit.user=${req.userId}`] } });
    res.json({ containers: list.map(c => ({ Id: c.Id, Names: c.Names, State: c.State, Status: c.Status, Image: c.Image, Kind: c.Labels['orbit.kind'] })) });
  } catch {
    res.status(503).json({ error: 'Docker is not available.', containers: [] });
  }
});
containers.post('/:id/:action', async (req, res) => {
  if (!['start', 'stop'].includes(req.params.action)) return res.status(404).json({ error: 'Unknown action' });
  try {
    const container = docker.getContainer(req.params.id);
    const info = await container.inspect().catch(() => null);
    if (!info || info.Config.Labels?.['orbit.user'] !== req.userId) return res.status(404).json({ error: 'Container not found.' });
    if (req.params.action === 'start') await container.start();
    else await container.stop({ t: 2 });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Container action failed.' });
  }
});
app.use('/api/containers', dockerLimiter, containers);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: config.isProd ? 'Internal server error' : err.message });
});

// ───────────── realtime: socket.io (terminals, sandbox I/O) ─────────────

const io = new Server(server, { cors: corsOptions, destroyUpgrade: false, maxHttpBufferSize: 1e6 });
app.set('io', io);

io.use((socket, next) => {
  const userId = verifyToken(socket.handshake.auth?.token);
  if (!userId) return next(new Error('unauthorized'));
  socket.data.userId = userId;
  next();
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.data.userId}`);
  attachTerminals(io, socket);
  runRoutes.attachSandboxIO(socket);
});

// ───────────── realtime: Yjs collaborative editing on /yjs/<room>?token= ─────────────

const yjs = new WebSocket.Server({ noServer: true });
yjs.on('connection', (conn, req, docName) => setupWSConnection(conn, req, { docName }));

server.on('upgrade', async (req, socket, head) => {
  if (req.url.startsWith('/preview/')) {
    if (!handlePreviewUpgrade(req, socket, head)) socket.destroy();
    return;
  }
  if (!req.url.startsWith('/yjs/')) return; // socket.io handles its own path
  try {
    const url = new URL(req.url, 'http://localhost');
    const docName = decodeURIComponent(url.pathname.slice('/yjs/'.length));
    const userId = verifyToken(url.searchParams.get('token'));
    // Rooms are "<projectId>-<fileId>"; only the project's owner may join.
    const projectId = docName.slice(0, 36);
    const owns = userId && await prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true } });
    const file = owns && await prisma.file.findFirst({ where: { id: docName.slice(37), projectId }, select: { id: true } });
    if (!file) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    yjs.handleUpgrade(req, socket, head, (ws) => yjs.emit('connection', ws, req, docName));
  } catch {
    socket.destroy();
  }
});

if (require.main === module) {
  server.listen(config.port, async () => {
    const [dockerOk, terminal] = await Promise.all([dockerAvailable(), resolveMode()]);
    console.log(`🚀 Orbit IDE backend on http://localhost:${config.port}`);
    console.log(`🤖 AI: ${ai.enabled() ? `Claude (${config.claudeModel})` : 'disabled — set ANTHROPIC_API_KEY'}`);
    console.log(`🐳 Docker: ${dockerOk ? 'connected' : 'not available'} · 🖥  Terminal: ${terminal}`);
    console.log(`🌐 CORS origins: ${config.corsOrigins.join(', ')}`);
    cleanupStaleContainers().catch(() => {});
  });

  const shutdown = () => {
    io.close();
    server.close(() => prisma.$disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { app, server };
