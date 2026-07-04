const express = require('express');
const prisma = require('../db');
const authMiddleware = require('../middleware/auth');
const validate = require('../middleware/validate');
const { projectSchema, fileSchema, renameSchema } = require('../schemas');
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ESLint } = require('eslint');
const { docs, getYDoc } = require('y-websocket/bin/utils');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const activeDeployments = {};

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
    const projects = await prisma.project.findMany({
        where: { userId: req.userId }, orderBy: { updatedAt: 'desc' },
    });
    res.json({ projects });
});

router.delete('/:id', async (req, res) => {
    try {
        const result = await prisma.project.deleteMany({
            where: { id: req.params.id, userId: req.userId }
        });
        if (result.count === 0) {
            return res.status(404).json({ error: 'Project not found or unauthorized.' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', async (req, res) => {
    const project = await prisma.project.findFirst({
        where: { id: req.params.id, userId: req.userId }, include: { files: true },
    });
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    res.json({ project });
});

router.post('/', validate(projectSchema), async (req, res) => {
    const { name } = req.body;
    const project = await prisma.project.create({
        data: {
            name: name || 'untitled-project', userId: req.userId,
            files: { create: [{ name: 'index.js', path: '', language: 'javascript', content: '// new file\n' }] },
        },
        include: { files: true },
    });
    res.json({ project });
});

router.put('/:projectId/files/:fileId', async (req, res) => {
    const { content } = req.body;
    const project = await prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const file = await prisma.file.update({ where: { id: req.params.fileId }, data: { content } });
    const doc = getYDoc(`${project.id}-${file.id}`);
    if (doc) {
        const ytext = doc.getText('monaco');
        if (ytext.toString() !== content) {
            ytext.delete(0, ytext.length);
            ytext.insert(0, content || '');
        }
    }
    
    if (activeDeployments[project.id] && !file.isFolder) {
        try {
            const fullPath = path.join(activeDeployments[project.id], file.path || '', file.name);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content || '');
        } catch (e) { console.error('Failed to sync deployed file:', e.message); }
    }
    
    res.json({ file });
});

router.patch('/:projectId/files/:fileId', validate(renameSchema), async (req, res) => {
    const { name } = req.body;
    const project = await prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    try {
        const file = await prisma.file.update({ where: { id: req.params.fileId }, data: { name } });
        res.json({ file });
    } catch (err) {
        res.status(400).json({ error: 'A file with that name may already exist in this folder.' });
    }
});

// Create a file OR a folder. body: { name, path, isFolder, language }
router.post('/:projectId/files', validate(fileSchema), async (req, res) => {
    const { name, path: filePath, isFolder, language } = req.body;
    const project = await prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    try {
        const file = await prisma.file.create({
            data: {
                name,
                path: filePath || '',
                isFolder: !!isFolder,
                language: isFolder ? '' : (language || 'javascript'),
                content: isFolder ? '' : '',
                projectId: project.id,
            },
        });
        res.json({ file });
    } catch (err) {
        res.status(400).json({ error: 'A file or folder with that name already exists here.' });
    }
});

router.delete('/:projectId/files/:fileId', async (req, res) => {
    const project = await prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const target = await prisma.file.findUnique({ where: { id: req.params.fileId } });
    if (!target) return res.json({ deleted: true }); // Idempotent delete
    if (target.isFolder) {
        // delete the folder and everything inside it
        const folderFullPath = target.path ? `${target.path}/${target.name}` : target.name;
        await prisma.file.deleteMany({
            where: {
                projectId: project.id,
                OR: [
                    { id: target.id },
                    { path: folderFullPath },
                    { path: { startsWith: folderFullPath + '/' } },
                ],
            },
        });
    } else {
        await prisma.file.delete({ where: { id: req.params.fileId } });
    }
    res.json({ deleted: true });
});

// Bulk create — used by the AI agent to scaffold multiple files/folders at once
router.post('/:projectId/scaffold', async (req, res) => {
    const { items } = req.body; // [{ name, path, isFolder, language, content }]
    const project = await prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const created = [];
    for (const item of items || []) {
        try {
            const file = await prisma.file.upsert({
                where: {
                    projectId_path_name: {
                        projectId: project.id,
                        path: item.path || '',
                        name: item.name,
                    }
                },
                update: {
                    content: item.isFolder ? '' : (item.content || ''),
                },
                create: {
                    name: item.name,
                    path: item.path || '',
                    isFolder: !!item.isFolder,
                    language: item.isFolder ? '' : (item.language || 'javascript'),
                    content: item.isFolder ? '' : (item.content || ''),
                    projectId: project.id,
                },
            });
            created.push(file);
            const doc = getYDoc(`${project.id}-${file.id}`);
            if (doc) {
                const ytext = doc.getText('monaco');
                const newContent = file.content || '';
                if (ytext.toString() !== newContent) {
                    ytext.delete(0, ytext.length);
                    ytext.insert(0, newContent);
                }
            }
        } catch (error) {
            console.error('Failed to scaffold item:', item.name, error.message);
        }
    }
    
    if (activeDeployments[project.id]) {
        for (const item of created) {
            try {
                const fullPath = path.join(activeDeployments[project.id], item.path || '', item.name);
                if (item.isFolder) {
                    fs.mkdirSync(fullPath, { recursive: true });
                } else {
                    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                    fs.writeFileSync(fullPath, item.content || '');
                }
            } catch (e) { console.error('Failed to sync scaffolded file:', e.message); }
        }
    }
    
    res.json({ success: true, files: created });
});

router.get('/:projectId/search', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { q } = req.query;
    if (!q) return res.json([]);
    
    const files = await prisma.file.findMany({
      where: {
        projectId,
        content: { contains: String(q) },
        isFolder: false
      },
      select: { id: true, name: true, path: true, content: true }
    });

    const results = [];
    for (const file of files) {
      if (!file.content) continue;
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(String(q))) {
          results.push({
            fileId: file.id,
            fileName: file.name,
            filePath: file.path,
            lineNumber: i + 1,
            lineContent: lines[i].trim()
          });
        }
      }
    }
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:projectId/replace', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { q, replaceWith } = req.body;
    if (!q) return res.json({ success: false });

    const files = await prisma.file.findMany({
      where: { projectId, isFolder: false, content: { contains: String(q) } }
    });

    for (const file of files) {
      if (!file.content) continue;
      const newContent = file.content.split(String(q)).join(String(replaceWith || ''));
      if (newContent !== file.content) {
        await prisma.file.update({
          where: { id: file.id },
          data: { content: newContent }
        });
        const doc = getYDoc(`${projectId}-${file.id}`);
        if (doc) {
            const ytext = doc.getText('monaco');
            if (ytext.toString() !== newContent) {
                ytext.delete(0, ytext.length);
                ytext.insert(0, newContent);
            }
        }
      }
    }
    res.json({ success: true, count: files.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:projectId/deploy', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: req.userId }, include: { files: true }
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-'));
    activeDeployments[projectId] = dir;
    
    for (const file of project.files) {
      const fullPath = path.join(dir, file.path || '', file.name);
      if (file.isFolder) {
        fs.mkdirSync(fullPath, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content || '');
      }
    }

    let image = 'node:20-alpine';
    let cmd = ['sh', '-c', 'cd /app && npm install && npm run dev'];
    let exposedPort = '5173/tcp';
    
    if (project.files.some(f => f.name === 'requirements.txt')) {
      image = 'python:3.12-alpine';
      cmd = ['sh', '-c', 'cd /app && pip install -r requirements.txt && python3 app.py'];
      exposedPort = '5000/tcp';
    } else if (project.files.some(f => f.name === 'index.html') && !project.files.some(f => f.name === 'package.json')) {
      image = 'python:3.12-alpine';
      cmd = ['sh', '-c', 'cd /app && python3 -m http.server 8080'];
      exposedPort = '8080/tcp';
    }

    const container = await docker.createContainer({
      Image: image,
      Cmd: cmd,
      ExposedPorts: { [exposedPort]: {} },
      HostConfig: {
        Binds: [`${dir}:/app`],
        PortBindings: { [exposedPort]: [{ HostPort: '0' }] },
      },
      Labels: { 'ai-cloud-ide-deploy': projectId }
    });

    await container.start();
    const data = await container.inspect();
    const hostPort = data.NetworkSettings.Ports[exposedPort]?.[0]?.HostPort;
    
    res.json({ success: true, url: `http://localhost:${hostPort}`, containerId: container.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:projectId/stop-deploy', async (req, res) => {
  try {
    const { containerId } = req.body;
    if (!containerId) return res.status(400).json({ error: 'Container ID required' });
    const container = docker.getContainer(containerId);
    await container.stop();
    await container.remove();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:projectId/lint', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.json({ results: [] });
    
    const eslint = new ESLint({
      useEslintrc: false,
      overrideConfig: {
        env: { browser: true, es2021: true, node: true },
        extends: ['eslint:recommended'],
        parserOptions: { ecmaVersion: 12, sourceType: 'module' },
        rules: { 'no-unused-vars': 'warn', 'no-console': 'off', 'no-undef': 'warn' }
      }
    });
    const results = await eslint.lintText(code);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
