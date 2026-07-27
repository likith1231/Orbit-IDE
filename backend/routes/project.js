const express = require('express');
const prisma = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// List user's projects
router.get('/', async (req, res) => {
    const projects = await prisma.project.findMany({
        where: { userId: req.userId },
        orderBy: { updatedAt: 'desc' },
    });
    res.json({ projects });
});

// Get one project with files
router.get('/:id', async (req, res) => {
    const project = await prisma.project.findFirst({
        where: { id: req.params.id, userId: req.userId },
        include: { files: true },
    });
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    res.json({ project });
});

// Create a new project
router.post('/', async (req, res) => {
    const { name } = req.body;
    const project = await prisma.project.create({
        data: {
            name: name || 'untitled-project',
            userId: req.userId,
        },
        include: { files: true },
    });
    res.json({ project });
});

// Update/save a file's content
router.put('/:projectId/files/:fileId', async (req, res) => {
    const { content } = req.body;
    const project = await prisma.project.findFirst({
        where: { id: req.params.projectId, userId: req.userId },
    });
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const file = await prisma.file.update({
        where: { id: req.params.fileId },
        data: { content },
    });
    res.json({ file });
});

// Create a new file in a project
router.post('/:projectId/files', async (req, res) => {
    const { name, language } = req.body;
    const project = await prisma.project.findFirst({
        where: { id: req.params.projectId, userId: req.userId },
    });
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const file = await prisma.file.create({
        data: { name, language: language || 'javascript', content: '', projectId: project.id },
    });
    res.json({ file });
});

module.exports = router;