const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../db');
const authMiddleware = require('../middleware/auth');
const validate = require('../middleware/validate');
const { aiChatSchema, aiDebugSchema, autocompleteSchema } = require('../schemas');
const ai = require('../lib/ai');

const router = express.Router();
router.use(authMiddleware);

// Per-user limits (on top of the per-IP limiter in server.js) so one account can't drain the API key.
const perUser = (max, windowMs) => rateLimit({
  windowMs, max,
  keyGenerator: (req) => req.userId,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'AI rate limit reached, please slow down.' },
});

async function projectFiles(userId, projectId) {
  const project = await prisma.project.findFirst({ where: { id: projectId, userId }, include: { files: true } });
  if (!project) throw new ai.AIError('Project not found.', 404);
  return project.files;
}

router.get('/models', (req, res) => {
  res.json({ enabled: ai.enabled(), models: ai.MODELS });
});

// Streams Server-Sent Events: {type:"text",text} ... then {type:"done",reply,changes,run} or {type:"error",error}.
router.post('/chat', perUser(60, 15 * 60 * 1000), validate(aiChatSchema), async (req, res) => {
  const { projectId, messages, activeFile, selection, model, verify } = req.body;
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });

  let files;
  try {
    files = await projectFiles(req.userId, projectId);
  } catch (err) {
    const e = ai.friendlyError(err);
    return res.status(e.status).json({ error: e.message });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);

  try {
    const result = await ai.chat({
      messages, files, activeFile, selection, model,
      verify: verify !== false,
      userId: req.userId,
      signal: controller.signal,
      onText: (text) => send({ type: 'text', text }),
      onEvent: (event) => send(event),
    });
    send({ type: 'done', ...result });
  } catch (err) {
    if (!controller.signal.aborted) {
      const e = ai.friendlyError(err);
      console.error('AI chat error:', err);
      send({ type: 'error', error: e.message });
    }
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

router.post('/debug', perUser(30, 15 * 60 * 1000), validate(aiDebugSchema), async (req, res) => {
  const { projectId, filePath, language, code, error } = req.body;
  try {
    const files = await projectFiles(req.userId, projectId);
    // Prefer the live editor content for the failing file.
    const rel = (f) => (f.path ? `${f.path}/${f.name}` : f.name);
    const merged = files.map(f => (rel(f) === filePath && typeof code === 'string' ? { ...f, content: code } : f));
    const result = await ai.debug({ files: merged, file: { path: filePath }, language, error });
    res.json(result);
  } catch (err) {
    const e = ai.friendlyError(err);
    console.error('AI debug error:', err);
    res.status(e.status).json({ error: e.message });
  }
});

router.post('/autocomplete', perUser(600, 15 * 60 * 1000), validate(autocompleteSchema), async (req, res) => {
  if (!ai.enabled()) return res.json({ completion: '' });
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });
  try {
    const completion = await ai.autocomplete({ ...req.body, signal: controller.signal });
    res.json({ completion });
  } catch {
    if (!res.headersSent) res.json({ completion: '' });
  }
});

module.exports = router;
