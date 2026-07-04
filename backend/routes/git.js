const express = require('express');
const { exec, execFile } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const prisma = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router({ mergeParams: true });
router.use(authMiddleware);

const GIT_DIR = path.join(__dirname, '..', 'data', 'git');

async function syncToDisk(projectId, userId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    include: { files: true }
  });
  if (!project) throw new Error('Project not found');

  const projectDir = path.join(GIT_DIR, projectId);
  await fs.mkdir(projectDir, { recursive: true });

  // Delete all existing files except .git
  const existing = await fs.readdir(projectDir).catch(() => []);
  for (const f of existing) {
    if (f !== '.git') {
      await fs.rm(path.join(projectDir, f), { recursive: true, force: true });
    }
  }

  // Write DB files to disk
  for (const file of project.files) {
    if (file.isFolder) continue;
    const filePath = path.join(projectDir, file.path ? path.join(file.path, file.name) : file.name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content || '');
  }

  // Init git if it doesn't exist
  const gitDirExists = await fs.stat(path.join(projectDir, '.git')).catch(() => false);
  if (!gitDirExists) {
    await execPromise(`git init`, { cwd: projectDir });
  }
  // Always enforce config
  await execPromise(`git config user.email "ide@aicloud.com"`, { cwd: projectDir });
  await execPromise(`git config user.name "AI Cloud IDE"`, { cwd: projectDir });
  await execPromise(`git config core.autocrlf false`, { cwd: projectDir });
  await execPromise(`git config core.safecrlf false`, { cwd: projectDir });

  return projectDir;
}

function execFilePromise(cmd, args, options) {
  return new Promise((resolve) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      if (error && !stdout.includes('nothing to commit')) resolve({ stdout, stderr, error });
      else resolve({ stdout, stderr });
    });
  });
}

function execPromise(cmd, options) {
  return new Promise((resolve, reject) => {
    exec(cmd, options, (error, stdout, stderr) => {
      // In git, empty commits return an error status but it's not a failure for our purposes
      if (error && !stdout.includes('nothing to commit')) resolve({ stdout, stderr, error });
      else resolve({ stdout, stderr });
    });
  });
}

router.get('/status', async (req, res) => {
  try {
    const cwd = await syncToDisk(req.params.projectId, req.userId);
    const { stdout } = await execPromise(`git status -s`, { cwd });
    res.json({ status: stdout.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/commit', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    
    const cwd = await syncToDisk(req.params.projectId, req.userId);
    const addRes = await execFilePromise('git', ['add', '.'], { cwd });
    console.log('GIT ADD:', addRes);
    
    const commitRes = await execFilePromise('git', ['commit', '-m', message], { cwd });
    console.log('GIT COMMIT:', commitRes);
    
    res.json({ success: !commitRes.error, output: commitRes.stdout, error: commitRes.error ? commitRes.stderr : null });
  } catch (err) {
    console.error('GIT COMMIT FATAL ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/log', async (req, res) => {
  try {
    const cwd = await syncToDisk(req.params.projectId, req.userId);
    const { stdout } = await execPromise(`git log -n 10 --pretty=format:"%h|%s|%ar|%an"`, { cwd });
    const logs = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [hash, message, time, author] = line.split('|');
      return { hash, message, time, author };
    });
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
