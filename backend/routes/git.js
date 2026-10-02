const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const prisma = require('../db');
const authMiddleware = require('../middleware/auth');
const workspace = require('../lib/workspace');

const router = express.Router({ mergeParams: true });
router.use(authMiddleware);

// Git runs directly in the project's workspace, the same directory the terminal uses,
// so commits made from the panel and from `git` in the terminal see the same repo.
function git(args, cwd) {
  return new Promise((resolve) => {
    // safe.directory: terminal containers may create files under a different uid.
    execFile('git', ['-c', 'safe.directory=*', ...args], { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, code: error ? (error.code ?? 1) : 0 });
    });
  });
}

async function prepare(req) {
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, userId: req.userId } });
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true, name: true } });
  const cwd = await workspace.syncToDisk(project.id);
  const hasRepo = await fs.stat(path.join(cwd, '.git')).then(() => true).catch(() => false);
  if (!hasRepo) {
    await git(['init', '-q', '-b', 'main'], cwd);
    // Keep dependency/build folders out of the repo without touching the user's .gitignore.
    await fs.mkdir(path.join(cwd, '.git', 'info'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.git', 'info', 'exclude'), [...workspace.IGNORED_DIRS].filter(d => d !== '.git').map(d => `${d}/`).join('\n') + '\n');
  }
  await git(['config', 'user.email', user?.email || 'ide@orbit.local'], cwd);
  await git(['config', 'user.name', user?.name || user?.email || 'Orbit IDE'], cwd);
  await git(['config', 'core.autocrlf', 'false'], cwd);
  return cwd;
}

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

router.get('/status', handle(async (req, res) => {
  const cwd = await prepare(req);
  const { stdout } = await git(['status', '--porcelain=v1', '--branch'], cwd);
  const lines = stdout.split('\n').filter(Boolean);
  const branch = (lines[0] || '').replace(/^## /, '').split('...')[0];
  const files = lines.slice(1).map(l => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3) }));
  res.json({ branch, files, status: lines.slice(1).join('\n') });
}));

router.get('/diff', handle(async (req, res) => {
  const cwd = await prepare(req);
  const file = req.query.path ? String(req.query.path) : null;
  const args = ['diff', 'HEAD', '--no-color'];
  if (file) args.push('--', file);
  let { stdout, code } = await git(args, cwd);
  if (code !== 0) stdout = (await git(['diff', '--no-color', ...(file ? ['--', file] : [])], cwd)).stdout; // no commits yet
  res.json({ diff: stdout.slice(0, 500_000) });
}));

router.post('/commit', handle(async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message required' });
  const cwd = await prepare(req);
  await git(['add', '-A'], cwd);
  const result = await git(['commit', '-m', message], cwd);
  const nothing = /nothing to commit/.test(result.stdout);
  res.json({ success: result.code === 0, output: result.stdout, error: result.code === 0 || nothing ? null : result.stderr || result.stdout, nothingToCommit: nothing });
}));

router.get('/log', handle(async (req, res) => {
  const cwd = await prepare(req);
  const { stdout } = await git(['log', '-n', '30', '--pretty=format:%h%x1f%s%x1f%ar%x1f%an'], cwd);
  const logs = stdout.split('\n').filter(Boolean).map(line => {
    const [hash, message, time, author] = line.split('\x1f');
    return { hash, message, time, author };
  });
  res.json({ logs });
}));

module.exports = router;
