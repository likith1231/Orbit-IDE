const express = require('express');
const { spawn } = require('child_process');
const prisma = require('../db');
const authMiddleware = require('../middleware/auth');
const validate = require('../middleware/validate');
const { projectSchema, fileSchema, fileContentSchema, renameSchema, scaffoldSchema } = require('../schemas');
const { Linter } = require('eslint');
const workspace = require('../lib/workspace');
const { joinRel } = require('../lib/paths');
const { docker, ensureImage, listeningPorts, publishedPorts, dockerAvailable } = require('../lib/docker');
const { previewPath } = require('../lib/preview');
const { findProjectContainer } = require('../lib/terminal');
const config = require('../config');
const { templateRows, templateList } = require('../lib/templates');

const router = express.Router();
router.use(authMiddleware);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Load the project for the current user, or 404. Attaches it as req.project.
const loadProject = wrap(async (req, res, next) => {
    const id = req.params.projectId || req.params.id;
    const project = await prisma.project.findFirst({ where: { id, userId: req.userId } });
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    req.project = project;
    next();
});

// A file of the current project, or null.
const findFile = (projectId, fileId) => prisma.file.findFirst({ where: { id: fileId, projectId } });

const touch = (projectId) => prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } }).catch(() => {});
const notifyFiles = (req, projectId) => req.app.get('io')?.to(`project:${projectId}`).emit('files-changed', { projectId });

router.get('/', wrap(async (req, res) => {
    const projects = await prisma.project.findMany({
        where: { userId: req.userId }, orderBy: { updatedAt: 'desc' },
    });
    res.json({ projects });
}));

router.get('/templates', (req, res) => res.json({ templates: templateList() }));

router.post('/', validate(projectSchema), wrap(async (req, res) => {
    const project = await prisma.project.create({
        data: { name: req.body.name, userId: req.userId, files: { create: templateRows(req.body.template || 'blank') } },
        include: { files: true },
    });
    res.json({ project });
}));

// Clone a public git repository (https) into a new project.
router.post('/clone', wrap(async (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (!/^https:\/\/[\w.-]+(:\d+)?\/[\w./~%-]+$/.test(url)) return res.status(400).json({ error: 'Enter an https:// git URL, e.g. https://github.com/user/repo' });
    const name = (url.split('/').pop() || 'repo').replace(/\.git$/, '').slice(0, 100) || 'repo';
    const project = await prisma.project.create({ data: { name, userId: req.userId } });
    const dir = workspace.workspaceDir(project.id);
    const result = await new Promise((resolve) => {
        const git = spawn('git', ['clone', '--depth', '1', '--single-branch', '--', url, dir], {
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // never hang asking for credentials
            timeout: 120000,
        });
        let err = '';
        git.stderr.on('data', d => { err += d; });
        git.on('close', code => resolve({ code, err }));
        git.on('error', e => resolve({ code: 1, err: e.message }));
    });
    if (result.code !== 0) {
        await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
        await workspace.removeEntry(project.id, '');
        const msg = /not found|could not read|Authentication/i.test(result.err) ? 'Repository not found or private (only public repos can be cloned).' : result.err.trim().split('\n').pop();
        return res.status(400).json({ error: `Clone failed: ${msg}` });
    }
    await workspace.importFromDisk(project.id);
    res.json({ project });
}));

router.get('/:id', loadProject, wrap(async (req, res) => {
    const files = await prisma.file.findMany({ where: { projectId: req.project.id } });
    res.json({ project: { ...req.project, files } });
}));

router.patch('/:id', loadProject, validate(projectSchema), wrap(async (req, res) => {
    const project = await prisma.project.update({ where: { id: req.project.id }, data: { name: req.body.name } });
    res.json({ project });
}));

router.delete('/:id', loadProject, wrap(async (req, res) => {
    await prisma.project.delete({ where: { id: req.project.id } });
    const term = await findProjectContainer(req.userId, req.project.id).catch(() => null);
    if (term) await term.container.remove({ force: true }).catch(() => {});
    await workspace.removeEntry(req.project.id, '');
    res.json({ success: true });
}));

// Save a file's content
router.put('/:projectId/files/:fileId', loadProject, validate(fileContentSchema), wrap(async (req, res) => {
    const existing = await findFile(req.project.id, req.params.fileId);
    if (!existing || existing.isFolder) return res.status(404).json({ error: 'File not found.' });
    const file = await prisma.file.update({ where: { id: existing.id }, data: { content: req.body.content } });
    workspace.updateLiveDoc(req.project.id, file.id, file.content);
    await workspace.writeEntry(req.project.id, file);
    touch(req.project.id);
    res.json({ file });
}));

// Rename a file or folder (folders carry their children along)
router.patch('/:projectId/files/:fileId', loadProject, validate(renameSchema), wrap(async (req, res) => {
    const target = await findFile(req.project.id, req.params.fileId);
    if (!target) return res.status(404).json({ error: 'File not found.' });
    const { name } = req.body;
    const oldRel = joinRel(target.path, target.name);
    const newRel = joinRel(target.path, name);
    try {
        await prisma.$transaction(async (tx) => {
            const file = await tx.file.update({
                where: { id: target.id },
                data: { name, ...(target.isFolder ? {} : { language: workspace.languageFor(name) }) },
            });
            if (target.isFolder) {
                const children = await tx.file.findMany({
                    where: { projectId: req.project.id, OR: [{ path: oldRel }, { path: { startsWith: oldRel + '/' } }] },
                });
                for (const c of children) {
                    await tx.file.update({ where: { id: c.id }, data: { path: newRel + c.path.slice(oldRel.length) } });
                }
            }
            return file;
        });
    } catch {
        return res.status(400).json({ error: 'A file with that name already exists in this folder.' });
    }
    await workspace.renameEntry(req.project.id, oldRel, newRel);
    const file = await prisma.file.findUnique({ where: { id: target.id } });
    res.json({ file });
}));

// Create a file OR a folder. body: { name, path, isFolder, language, content }
router.post('/:projectId/files', loadProject, validate(fileSchema), wrap(async (req, res) => {
    const { name, path: filePath = '', isFolder, language, content } = req.body;
    try {
        // Make sure parent folders exist as explicit entries so they show up in the tree.
        const parts = filePath.split('/').filter(Boolean);
        for (let i = 0; i < parts.length; i++) {
            await prisma.file.upsert({
                where: { projectId_path_name: { projectId: req.project.id, path: parts.slice(0, i).join('/'), name: parts[i] } },
                update: {},
                create: { projectId: req.project.id, path: parts.slice(0, i).join('/'), name: parts[i], isFolder: true, language: '' },
            });
        }
        const file = await prisma.file.create({
            data: {
                name,
                path: parts.join('/'),
                isFolder: !!isFolder,
                language: isFolder ? '' : (language || workspace.languageFor(name)),
                content: isFolder ? '' : (content || ''),
                projectId: req.project.id,
            },
        });
        await workspace.writeEntry(req.project.id, file);
        touch(req.project.id);
        res.json({ file });
    } catch {
        res.status(400).json({ error: 'A file or folder with that name already exists here.' });
    }
}));

router.delete('/:projectId/files/:fileId', loadProject, wrap(async (req, res) => {
    const target = await findFile(req.project.id, req.params.fileId);
    if (!target) return res.json({ deleted: true }); // idempotent
    const rel = joinRel(target.path, target.name);
    if (target.isFolder) {
        await prisma.file.deleteMany({
            where: {
                projectId: req.project.id,
                OR: [{ id: target.id }, { path: rel }, { path: { startsWith: rel + '/' } }],
            },
        });
    } else {
        await prisma.file.delete({ where: { id: target.id } });
    }
    await workspace.removeEntry(req.project.id, rel);
    touch(req.project.id);
    res.json({ deleted: true });
}));

// Bulk create/update — used when applying AI changes. Creates missing parent folders.
router.post('/:projectId/scaffold', loadProject, validate(scaffoldSchema), wrap(async (req, res) => {
    const projectId = req.project.id;
    const created = [];
    const folders = new Set();
    for (const item of req.body.items) {
        const parts = (item.path || '').split('/').filter(Boolean);
        for (let i = 0; i < parts.length; i++) folders.add(joinRel(parts.slice(0, i).join('/'), parts[i]));
        if (item.isFolder) folders.add(joinRel(parts.join('/'), item.name));
    }
    for (const rel of [...folders].sort((a, b) => a.split('/').length - b.split('/').length)) {
        const i = rel.lastIndexOf('/');
        const p = i === -1 ? '' : rel.slice(0, i);
        const name = i === -1 ? rel : rel.slice(i + 1);
        await prisma.file.upsert({
            where: { projectId_path_name: { projectId, path: p, name } },
            update: {},
            create: { projectId, path: p, name, isFolder: true, language: '' },
        }).catch(() => {});
    }
    for (const item of req.body.items) {
        if (item.isFolder) continue;
        const p = (item.path || '').split('/').filter(Boolean).join('/');
        try {
            const file = await prisma.file.upsert({
                where: { projectId_path_name: { projectId, path: p, name: item.name } },
                update: { content: item.content || '' },
                create: {
                    name: item.name,
                    path: p,
                    isFolder: false,
                    language: item.language || workspace.languageFor(item.name),
                    content: item.content || '',
                    projectId,
                },
            });
            created.push(file);
            workspace.updateLiveDoc(projectId, file.id, file.content);
            await workspace.writeEntry(projectId, file);
        } catch (error) {
            console.error('Failed to scaffold item:', item.name, error.message);
        }
    }
    touch(projectId);
    res.json({ success: true, files: created });
}));

// Download the project as a .tar.gz (dependency and build folders excluded).
router.get('/:projectId/download', loadProject, wrap(async (req, res) => {
    const dir = await workspace.syncToDisk(req.project.id);
    const excludes = [...workspace.IGNORED_DIRS].map(d => `--exclude=./${d}`);
    const safeName = req.project.name.replace(/[^\w.-]+/g, '-') || 'project';
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.tar.gz"`);
    const tar = spawn('tar', ['-czf', '-', ...excludes, '-C', dir, '.']);
    tar.stdout.pipe(res);
    tar.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
    req.on('close', () => tar.kill());
}));

// Pull changes made on disk (terminal, git, package managers) into the editor.
router.post('/:projectId/workspace/import', loadProject, wrap(async (req, res) => {
    if (!workspace.workspaceExists(req.project.id)) await workspace.syncToDisk(req.project.id);
    const changed = await workspace.importFromDisk(req.project.id);
    if (changed) notifyFiles(req, req.project.id);
    res.json({ changed });
}));

router.get('/:projectId/search', loadProject, wrap(async (req, res) => {
    const q = String(req.query.q || '');
    if (!q) return res.json([]);
    const files = await prisma.file.findMany({
        where: { projectId: req.project.id, isFolder: false, content: { contains: q } },
        select: { id: true, name: true, path: true, content: true },
    });
    const results = [];
    for (const file of files) {
        file.content.split('\n').forEach((line, i) => {
            if (line.includes(q)) {
                results.push({ fileId: file.id, fileName: file.name, filePath: file.path, lineNumber: i + 1, lineContent: line.trim() });
            }
        });
    }
    res.json(results.slice(0, 500));
}));

router.post('/:projectId/replace', loadProject, wrap(async (req, res) => {
    const q = String(req.body?.q || '');
    const replaceWith = String(req.body?.replaceWith ?? '');
    if (!q) return res.json({ success: false, count: 0 });
    const files = await prisma.file.findMany({
        where: { projectId: req.project.id, isFolder: false, content: { contains: q } },
    });
    for (const file of files) {
        const content = file.content.split(q).join(replaceWith);
        const updated = await prisma.file.update({ where: { id: file.id }, data: { content } });
        workspace.updateLiveDoc(req.project.id, file.id, content);
        await workspace.writeEntry(req.project.id, updated);
    }
    res.json({ success: true, count: files.length });
}));

// Ports that the project's terminal container is serving, as preview URLs.
router.get('/:projectId/ports', loadProject, wrap(async (req, res) => {
    const term = await findProjectContainer(req.userId, req.project.id).catch(() => null);
    if (!term) return res.json({ ports: {} });
    const mapped = publishedPorts(term.info);
    const listening = await listeningPorts(term.container).catch(() => []);
    const ports = {};
    for (const p of listening) {
        if (mapped[`${p}/tcp`]) ports[p] = previewPath(mapped[`${p}/tcp`], req.userId);
    }
    res.json({ ports });
}));

// "Deploy": keep the app running in a container that serves the live workspace.
router.post('/:projectId/deploy', loadProject, wrap(async (req, res) => {
    if (!(await dockerAvailable())) return res.status(503).json({ error: 'Docker is not available on this server.' });
    const projectId = req.project.id;
    const files = await prisma.file.findMany({ where: { projectId } });
    const dir = await workspace.syncToDisk(projectId);
    const has = (n) => files.some(f => !f.isFolder && !f.path && f.name === n);

    let image = 'node:20-alpine';
    let cmd = 'npm install --no-audit --no-fund && (npm run dev -- --host 0.0.0.0 || npm start)';
    let port = 5173;
    if (has('package.json')) {
        const pkg = (() => { try { return JSON.parse(files.find(f => f.name === 'package.json' && !f.path).content); } catch { return {}; } })();
        if (!pkg.scripts?.dev) { cmd = 'npm install --no-audit --no-fund && npm start'; port = 3000; }
    } else if (has('requirements.txt')) {
        image = 'python:3.12-alpine';
        const entry = ['app.py', 'main.py', 'server.py'].find(has) || 'app.py';
        cmd = `pip install -r requirements.txt && python3 ${entry}`;
        port = 5000;
    } else if (has('index.html')) {
        image = 'python:3.12-alpine';
        cmd = 'python3 -m http.server 8080 --bind 0.0.0.0';
        port = 8080;
    } else {
        return res.status(400).json({ error: 'Nothing to deploy: add a package.json, requirements.txt or index.html at the project root.' });
    }

    const old = await docker.listContainers({ all: true, filters: { label: [`orbit.deploy=${projectId}`] } });
    await Promise.all(old.map(c => docker.getContainer(c.Id).remove({ force: true }).catch(() => {})));

    await ensureImage(image);
    const container = await docker.createContainer({
        Image: image,
        Cmd: ['sh', '-c', `cd /app && ${cmd}`],
        Env: ['HOST=0.0.0.0', `PORT=${port}`],
        ExposedPorts: { [`${port}/tcp`]: {} },
        Labels: { 'orbit.kind': 'deploy', 'orbit.user': req.userId, 'orbit.deploy': projectId },
        HostConfig: {
            Binds: [`${dir}:/app`],
            PortBindings: { [`${port}/tcp`]: [{ HostIp: config.previewHost, HostPort: '0' }] },
            Memory: 512 * 1024 * 1024,
            NanoCpus: 1e9,
            PidsLimit: 256,
            SecurityOpt: ['no-new-privileges'],
            RestartPolicy: { Name: 'unless-stopped' },
        },
    });
    await container.start();
    const hostPort = publishedPorts(await container.inspect())[`${port}/tcp`];
    res.json({ success: true, path: previewPath(hostPort, req.userId, '30d'), containerId: container.id });
}));

router.post('/:projectId/stop-deploy', loadProject, wrap(async (req, res) => {
    const old = await docker.listContainers({ all: true, filters: { label: [`orbit.deploy=${req.project.id}`] } });
    await Promise.all(old.map(c => docker.getContainer(c.Id).remove({ force: true }).catch(() => {})));
    res.json({ success: true });
}));

// ESLint (flat config) for JavaScript files only.
const linter = new Linter({ configType: 'flat' });
const LINT_CONFIG = [{
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
        'no-unused-vars': 'warn',
        'no-unreachable': 'warn',
        'no-dupe-keys': 'error',
        'no-dupe-args': 'error',
        'no-duplicate-case': 'error',
        'no-const-assign': 'error',
        'no-func-assign': 'error',
        'no-self-assign': 'warn',
        'no-unsafe-finally': 'error',
        'use-isnan': 'error',
        'valid-typeof': 'error',
        'no-debugger': 'warn',
        'no-empty': 'warn',
        'constructor-super': 'error',
        'no-this-before-super': 'error',
    },
}];
router.post('/:projectId/lint', loadProject, (req, res) => {
    const { code, fileName = 'file.js' } = req.body || {};
    if (typeof code !== 'string' || !/\.(m?jsx?|cjs)$/i.test(fileName)) return res.json({ results: [{ messages: [] }] });
    try {
        const messages = linter.verify(code, LINT_CONFIG, { filename: fileName });
        res.json({ results: [{ messages }] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
