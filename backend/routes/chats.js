const express = require('express');
const prisma = require('../db');
const authMiddleware = require('../middleware/auth');

// Mounted twice:
//   /api/projects/:projectId/chats  -> list / create sessions for a project
//   /api/chats                      -> operate on a session by id
const router = express.Router({ mergeParams: true });
router.use(authMiddleware);

const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (error) { res.status(500).json({ error: error.message }); }
};

async function ownedProject(req) {
  return prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId }, select: { id: true } });
}

async function ownedSession(req) {
  return prisma.chatSession.findFirst({
    where: { id: req.params.sessionId, project: { userId: req.userId } },
  });
}

router.get('/', handle(async (req, res) => {
  if (!req.params.projectId || !(await ownedProject(req))) return res.status(404).json({ error: 'Project not found' });
  const sessions = await prisma.chatSession.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({ sessions });
}));

router.post('/', handle(async (req, res) => {
  if (!req.params.projectId || !(await ownedProject(req))) return res.status(404).json({ error: 'Project not found' });
  const name = String(req.body?.name || 'New Chat').slice(0, 100);
  const session = await prisma.chatSession.create({ data: { name, projectId: req.params.projectId } });
  res.json({ session });
}));

router.get('/:sessionId/messages', handle(async (req, res) => {
  if (!(await ownedSession(req))) return res.status(404).json({ error: 'Chat not found' });
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: req.params.sessionId },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ messages });
}));

router.post('/:sessionId/messages', handle(async (req, res) => {
  if (!(await ownedSession(req))) return res.status(404).json({ error: 'Chat not found' });
  const role = req.body?.role === 'user' ? 'user' : 'assistant';
  const content = String(req.body?.content || '').slice(0, 500_000);
  const message = await prisma.chatMessage.create({ data: { sessionId: req.params.sessionId, role, content } });
  await prisma.chatSession.update({ where: { id: req.params.sessionId }, data: { updatedAt: new Date() } });
  res.json({ message });
}));

router.put('/:sessionId', handle(async (req, res) => {
  if (!(await ownedSession(req))) return res.status(404).json({ error: 'Chat not found' });
  const name = String(req.body?.name || '').trim().slice(0, 100) || 'Untitled chat';
  const session = await prisma.chatSession.update({ where: { id: req.params.sessionId }, data: { name } });
  res.json({ session });
}));

router.delete('/:sessionId', handle(async (req, res) => {
  if (!(await ownedSession(req))) return res.status(404).json({ error: 'Chat not found' });
  await prisma.chatSession.delete({ where: { id: req.params.sessionId } });
  res.json({ success: true });
}));

module.exports = router;
