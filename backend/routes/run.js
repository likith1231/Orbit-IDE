const express = require('express');
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const validate = require('../middleware/validate');
const { codeExecutionSchema } = require('../schemas');

const router = express.Router();
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// One Docker image per language. Images download on first use (cached after).
const IMAGES = {
  javascript: 'node:20-alpine',
  typescript: 'node:20-alpine',
  python: 'python:3.12-alpine',
  java: 'eclipse-temurin:21-jdk-alpine',
  c: 'gcc:13-bookworm',
  cpp: 'gcc:13-bookworm',
  csharp: 'mcr.microsoft.com/dotnet/sdk:8.0-alpine',
  go: 'golang:1.22-alpine',
  rust: 'rust:1.78-slim',
  ruby: 'ruby:3.3-alpine',
  php: 'php:8.3-cli-alpine',
  bash: 'bash:5.2-alpine',
  perl: 'perl:5.38-slim',
  lua: 'akorn/lua:5.4-alpine',
  r: 'r-base:4.3.3',
  html: 'python:3.12-alpine',
};

// Builds the in-container shell command for each language.
// fileName is whatever the user named their file; we normalize where the language requires it.
function buildCmd(language, fileName, dir) {
  switch (language) {
    case 'javascript': {
      const hasPkg = fs.existsSync(path.join(dir, 'package.json'));
      return ['sh', '-c', `cd /sandbox && ${hasPkg ? 'npm install && ' : ''}node ${fileName}`];
    }
    case 'typescript':
      return ['sh', '-c', `cd /sandbox && npx -y tsx ${fileName}`];
    case 'python': {
      const hasReqs = fs.existsSync(path.join(dir, 'requirements.txt'));
      return ['sh', '-c', `cd /sandbox && ${hasReqs ? 'pip install -r requirements.txt && ' : ''}python3 ${fileName}`];
    }
    case 'java': {
      const className = fileName.replace(/\.java$/, '');
      return ['sh', '-c', `cd /sandbox && javac ${fileName} && java ${className}`];
    }
    case 'c':
      return ['sh', '-c', `cd /sandbox && gcc ${fileName} -o out -lm && ./out`];
    case 'cpp':
      return ['sh', '-c', `cd /sandbox && g++ ${fileName} -o out && ./out`];
    case 'csharp':
      return ['sh', '-c', `cd /sandbox && mkdir -p app && cd app && dotnet new console -o . --force >/dev/null 2>&1 && cp ../${fileName} Program.cs && dotnet run`];
    case 'go':
      return ['sh', '-c', `cd /sandbox && go run ${fileName}`];
    case 'rust':
      return ['sh', '-c', `cd /sandbox && rustc ${fileName} -o out 2>&1 && ./out`];
    case 'ruby':
      return ['ruby', `/sandbox/${fileName}`];
    case 'php':
      return ['php', `/sandbox/${fileName}`];
    case 'bash':
      return ['bash', `/sandbox/${fileName}`];
    case 'perl':
      return ['perl', `/sandbox/${fileName}`];
    case 'lua':
      return ['lua', `/sandbox/${fileName}`];
    case 'r':
      return ['Rscript', `/sandbox/${fileName}`];
    case 'html':
      return ['sh', '-c', `cd /sandbox && python3 -m http.server 8080`];
    default:
      return null;
  }
}

router.post('/', validate(codeExecutionSchema), async (req, res) => {
  const { code, language, fileName, socketId } = req.body;
  const image = IMAGES[language];
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-'));
    
    if (req.body.projectFiles && Array.isArray(req.body.projectFiles)) {
      for (const file of req.body.projectFiles) {
        const fullPath = path.join(dir, file.path || '', file.name);
        console.log(`Writing file ${file.name} to ${fullPath}, content length: ${(file.content || '').length}`);
        if (file.isFolder) {
          fs.mkdirSync(fullPath, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, file.content || '');
        }
      }
    } else {
      const safeName = fileName || 'main';
      fs.writeFileSync(path.join(dir, safeName), code || '');
    }

    const cmd = buildCmd(language, fileName, dir);
    if (!cmd) return res.status(400).json({ error: 'Unsupported language' });

    // Kill any existing containers to free up ports
    try {
      const existing = await docker.listContainers({ filters: { label: ['ai-ide=true'] } });
      for (const c of existing) {
        await docker.getContainer(c.Id).remove({ force: true }).catch(() => {});
      }
    } catch (err) { console.error('Failed to cleanup old containers', err); }

    const container = await docker.createContainer({
      Image: image,
      Cmd: cmd,
      WorkingDir: '/sandbox',
      Labels: { 'ai-ide': 'true' },
      ExposedPorts: {
        '3000/tcp': {},
        '5000/tcp': {},
        '8080/tcp': {}
      },
      HostConfig: {
        Binds: [`${dir}:/sandbox:rw`],
        Memory: 512 * 1024 * 1024,
        NanoCpus: 1000000000,
        AutoRemove: true,
        NetworkMode: ['typescript', 'csharp', 'javascript', 'python', 'html'].includes(language) ? 'bridge' : 'none',
        PortBindings: {
          '3000/tcp': [{ HostPort: '0' }],
          '5000/tcp': [{ HostPort: '0' }],
          '8080/tcp': [{ HostPort: '0' }]
        },
      },
      Tty: false,
    });

    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    
    const io = req.app.get('io');
    stream.on('data', (chunk) => {
      // Docker multiplexes stdout and stderr by adding an 8-byte header to each frame.
      // A quick fix to avoid binary gibberish is to strip non-printable bytes or parse the header properly.
      // Removing control characters 0x00-0x08 removes the header safely for plain text.
      const clean = chunk.toString('utf8').replace(/[\x00-\x08]/g, '');
      if (io && socketId) {
        io.to(socketId).emit('sandbox-output', clean);
      }
    });

    await container.start();

    // Fetch mapped ports
    const info = await container.inspect();
    const ports = info.NetworkSettings.Ports;
    const mappedPorts = {};
    for (const [key, value] of Object.entries(ports || {})) {
      if (value && value.length > 0) {
        mappedPorts[key] = value[0].HostPort;
      }
    }

    // Return immediately so the HTTP request doesn't hang
    res.json({ containerId: container.id, mappedPorts, message: 'Sandbox started' });

    // Cleanup when container finishes naturally or via stop
    container.wait().then(() => {
      if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
      if (io && socketId) io.to(socketId).emit('sandbox-exit', { code: 0 });
    }).catch(err => {
      if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
      if (io && socketId) io.to(socketId).emit('sandbox-exit', { error: err.message });
    });

    // Max execution time of 10 minutes for long-running servers
    setTimeout(async () => {
      try { await container.stop(); } catch {}
    }, 600000);

  } catch (err) {
    console.error('Sandbox run error:', err.message);
    if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
    res.status(500).json({ error: 'Execution failed: ' + err.message });
  }
});

router.post('/stop', async (req, res) => {
  const { containerId } = req.body;
  if (!containerId) return res.status(400).json({ error: 'Missing containerId' });
  try {
    const container = docker.getContainer(containerId);
    await container.kill().catch(() => {}); // Kill instantly, ignore errors if already stopped
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
