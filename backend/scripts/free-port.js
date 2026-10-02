#!/usr/bin/env node
// Runs before `npm start` / `npm run dev`. If an earlier Orbit backend (old or current) is still
// holding the port, stop it, so the code you just pulled is what actually runs.
// Anything else on the port is left alone and reported.
const net = require('net');
const { execSync } = require('child_process');
require('dotenv').config({ quiet: true });

const port = Number(process.env.PORT) || 5000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const portBusy = () => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});

async function getJson(path) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(3000) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return null;
  }
}

// Is whatever listens on the port an Orbit backend (any version)?
async function isOrbit() {
  const health = await getJson('/api/health');
  if (health?.body && 'db' in health.body) return `version ${health.body.version || '1.x'}`;
  // Old versions had no /api/health but did serve /api/containers/list.
  const old = await getJson('/api/containers/list');
  if (old?.body && ('containers' in old.body || 'error' in old.body)) return 'old version (1.x)';
  return null;
}

function pidsOnPort() {
  const cmds = [
    `lsof -t -iTCP:${port} -sTCP:LISTEN`,
    `fuser ${port}/tcp 2>/dev/null`,
  ];
  for (const cmd of cmds) {
    try {
      const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const pids = out.split(/\s+/).map(Number).filter(p => p && p !== process.pid);
      if (pids.length) return pids;
    } catch { /* tool missing or nothing found */ }
  }
  return [];
}

(async () => {
  if (!(await portBusy())) return;
  const which = await isOrbit();
  if (!which) {
    console.error(`\n✖ Port ${port} is used by another program (not Orbit). Stop it or set PORT=... in backend/.env.\n`);
    process.exit(1);
  }
  const pids = pidsOnPort();
  if (!pids.length) {
    console.error(`\n✖ An Orbit backend (${which}) is already running on port ${port}, but I couldn't find its process.`);
    console.error(`  Stop it yourself:  kill $(lsof -t -i:${port})   — or close the terminal it runs in.\n`);
    process.exit(1);
  }
  console.log(`↻ Stopping the Orbit backend that was already running on port ${port} (${which}, pid ${pids.join(', ')})...`);
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  for (let i = 0; i < 25 && await portBusy(); i++) await sleep(200);
  if (await portBusy()) for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  for (let i = 0; i < 10 && await portBusy(); i++) await sleep(200);
  if (await portBusy()) {
    console.error(`✖ Port ${port} is still busy. Run: kill -9 $(lsof -t -i:${port})`);
    process.exit(1);
  }
  console.log('✔ Old backend stopped.\n');
})();
