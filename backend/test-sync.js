const path = require('path');
const fs = require('fs').promises;
const prisma = require('./db');
const { exec } = require('child_process');

async function test() {
  const project = await prisma.project.findFirst({
    include: { files: true }
  });
  console.log('Project ID:', project.id);
  
  const GIT_DIR = path.join(__dirname, 'data', 'git');
  const projectDir = path.join(GIT_DIR, project.id);
  await fs.mkdir(projectDir, { recursive: true });

  const existing = await fs.readdir(projectDir).catch(() => []);
  for (const f of existing) {
    if (f !== '.git') {
      await fs.rm(path.join(projectDir, f), { recursive: true, force: true });
    }
  }

  for (const file of project.files) {
    if (file.isFolder) continue;
    const filePath = path.join(projectDir, file.path ? path.join(file.path, file.name) : file.name);
    console.log('Writing file:', filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content || '');
  }

  const gitDirExists = await fs.stat(path.join(projectDir, '.git')).catch(() => false);
  if (!gitDirExists) {
    console.log('Running git init');
    await execPromise(`git init`, { cwd: projectDir });
    await execPromise(`git config user.email "ide@aicloud.com"`, { cwd: projectDir });
    await execPromise(`git config user.name "AI Cloud IDE"`, { cwd: projectDir });
    const { error, stdout } = await execPromise(`git add . && git commit -m "Initial scaffold"`, { cwd: projectDir });
    console.log('Git commit result:', error, stdout);
  } else {
    console.log('Git already initialized');
  }
}

function execPromise(cmd, options) {
  return new Promise((resolve, reject) => {
    exec(cmd, options, (error, stdout, stderr) => {
      if (error && !stdout.includes('nothing to commit')) resolve({ stdout, stderr, error });
      else resolve({ stdout, stderr });
    });
  });
}

test().catch(console.error);
