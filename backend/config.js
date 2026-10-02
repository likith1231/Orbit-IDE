require('dotenv').config();
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

if (!process.env.JWT_SECRET) {
  if (isProd) {
    throw new Error('JWT_SECRET must be set in production. Generate one with: openssl rand -hex 64');
  }
  process.env.JWT_SECRET = 'dev-insecure-secret-change-me';
  console.warn('⚠  JWT_SECRET is not set — using an insecure development secret.');
}

const list = (v, fallback) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : fallback);

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

module.exports = {
  isProd,
  isTest,
  port: Number(process.env.PORT) || 5000,
  jwtSecret: process.env.JWT_SECRET,
  corsOrigins: list(process.env.CORS_ORIGINS, ['http://localhost:5173', 'https://orbit-ide-rho.vercel.app']),

  // All host-side directories that get bind-mounted into containers live under DATA_DIR.
  // When the backend itself runs in Docker, mount DATA_DIR at the SAME path on host and
  // in the container (see docker-compose.yml), otherwise sibling containers see empty dirs.
  dataDir,
  workspaceRoot: path.join(dataDir, 'workspaces'),
  sandboxRoot: path.join(dataDir, 'sandboxes'),

  dockerSocket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
  // Optional Docker Hub mirror host, e.g. "mirror.gcr.io", to dodge Docker Hub pull rate limits.
  imageMirror: process.env.DOCKER_IMAGE_MIRROR || '',

  // Terminal: auto | docker | local | off
  //   docker — each project gets its own container; safe for multi-user cloud deployments
  //   local  — shell runs on the backend host (node-pty if installed, otherwise a fallback). Dev only.
  terminalMode: process.env.TERMINAL_MODE || 'auto',
  terminalImage: process.env.TERMINAL_IMAGE || 'node:20-bookworm-slim',
  terminalIdleMinutes: Number(process.env.TERMINAL_IDLE_MINUTES) || 20,
  terminalMemoryMb: Number(process.env.TERMINAL_MEMORY_MB) || 1024,

  // Host that published container ports are reachable on, from the backend's point of view.
  previewHost: process.env.PREVIEW_HOST || '127.0.0.1',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
  // Used for latency-sensitive inline autocomplete only.
  claudeFastModel: process.env.CLAUDE_FAST_MODEL || 'claude-haiku-4-5',
  ollamaUrl: process.env.OLLAMA_URL || '',
};
