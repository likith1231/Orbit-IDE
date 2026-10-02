#!/usr/bin/env node
// Checks that everything the backend needs is set up, and says how to fix what isn't.
// Usage: npm run doctor
const fs = require('fs');
const path = require('path');
const net = require('net');

const envPath = path.join(__dirname, '..', '.env');
const results = [];
const ok = (name, detail = '') => results.push(['✔', name, detail]);
const warn = (name, detail) => results.push(['!', name, detail]);
const fail = (name, detail) => results.push(['✖', name, detail]);

async function main() {
  // Node
  const major = Number(process.versions.node.split('.')[0]);
  major >= 18 ? ok('Node.js', process.versions.node) : fail('Node.js', `${process.versions.node} — need 18 or newer`);

  // .env
  if (!fs.existsSync(envPath)) {
    fail('.env file', 'missing — run: cp .env.example .env   then fill it in');
  } else {
    ok('.env file');
  }
  const config = require('../config');

  if (process.env.JWT_SECRET) ok('JWT_SECRET');
  else warn('JWT_SECRET', 'not set — using an insecure dev secret. Generate one: openssl rand -hex 64');
  if (process.env.GEMINI_API_KEY) warn('GEMINI_API_KEY', 'no longer used (Orbit uses Claude now) — you can delete this line');
  if (process.env.TERMINAL_ENABLED) warn('TERMINAL_ENABLED', 'no longer used — the terminal is controlled by TERMINAL_MODE (default: auto)');

  // Database
  if (!process.env.DATABASE_URL) {
    fail('Database', 'DATABASE_URL is not set in .env');
  } else {
    const prisma = require('../db');
    try {
      await prisma.$queryRaw`SELECT 1`;
      ok('Database connection');
      const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
      const expected = fs.readdirSync(migrationsDir).filter(d => fs.statSync(path.join(migrationsDir, d)).isDirectory());
      const applied = await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`
        .then(rows => rows.map(r => r.migration_name)).catch(() => null);
      if (!applied) fail('Database migrations', 'not set up — run: npx prisma migrate deploy');
      else {
        const missing = expected.filter(m => !applied.includes(m));
        missing.length ? fail('Database migrations', `${missing.length} pending — run: npx prisma migrate deploy`) : ok('Database migrations', `${expected.length} applied`);
      }
    } catch (e) {
      fail('Database connection', `${e.message.split('\n').filter(Boolean).pop()} — is PostgreSQL running and DATABASE_URL correct?`);
    } finally {
      await prisma.$disconnect().catch(() => {});
    }
  }

  // Docker
  const { docker, dockerAvailable } = require('../lib/docker');
  if (await dockerAvailable()) {
    ok('Docker', 'reachable');
    const hasImage = (img) => docker.getImage(img).inspect().then(() => true).catch(() => false);
    if (await hasImage(config.terminalImage)) ok('Terminal image', config.terminalImage);
    else warn('Terminal image', `${config.terminalImage} not built (terminal falls back to ${config.terminalFallbackImage}, which has no python/git). Build it from the repo root:\n      docker build -t orbit-terminal:latest -f docker/terminal.Dockerfile docker`);
  } else {
    fail('Docker', `cannot reach ${config.dockerSocket}. Start Docker, and make sure your user can run "docker ps" (sudo usermod -aG docker $USER, then log out/in).`);
  }
  const { resolveMode } = require('../lib/terminal');
  const mode = await resolveMode();
  mode === 'off' ? fail('Terminal', 'disabled (no Docker)') : ok('Terminal mode', mode);

  // Claude
  if (!config.anthropicApiKey) {
    fail('Claude API key', 'missing — add ANTHROPIC_API_KEY=sk-ant-... to backend/.env');
  } else {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: config.anthropicApiKey });
      await client.messages.create({ model: config.claudeFastModel, max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] });
      ok('Claude API key', `works (default model: ${config.claudeModel})`);
    } catch (e) {
      fail('Claude API key', `rejected: ${e.status || ''} ${e.message}`.trim());
    }
  }

  // Port
  const free = await new Promise((resolve) => {
    const srv = net.createServer().once('error', () => resolve(false)).once('listening', () => srv.close(() => resolve(true)));
    srv.listen(config.port, config.host);
  });
  free ? ok(`Port ${config.port}`, 'free') : warn(`Port ${config.port}`, `in use — if that's an OLD backend, stop it first: kill $(lsof -t -i:${config.port})`);

  // Report
  console.log('\nOrbit IDE backend check\n');
  for (const [icon, name, detail] of results) console.log(` ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  const failed = results.filter(r => r[0] === '✖').length;
  console.log(failed ? `\n${failed} problem(s) to fix before starting.\n` : '\nAll good. Start the backend with: npm start\n');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
