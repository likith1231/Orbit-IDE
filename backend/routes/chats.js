const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router({ mergeParams: true });

// Get all chat sessions for a project
router.get('/', async (req, res) => {
  const { projectId } = req.params;
  try {
    const sessions = await prisma.chatSession.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new chat session
router.post('/', async (req, res) => {
  const { projectId } = req.params;
  const { name } = req.body;
  try {
    const session = await prisma.chatSession.create({
      data: { name: name || 'New Chat', projectId }
    });
    res.json({ session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a session
router.get('/:sessionId/messages', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' }
    });
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename session
router.put('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { name } = req.body;
  try {
    const session = await prisma.chatSession.update({
      where: { id: sessionId },
      data: { name }
    });
    res.json({ session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete session
router.delete('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    await prisma.chatSession.delete({ where: { id: sessionId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

// Add message to session
router.post('/:sessionId/messages', async (req, res) => {
  const { sessionId } = req.params;
  const { role, content } = req.body;
  try {
    const message = await prisma.chatMessage.create({
      data: { sessionId, role, content }
    });
    res.json({ message });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
