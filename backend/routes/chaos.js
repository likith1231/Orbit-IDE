const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const validate = require('../middleware/validate');
const authMiddleware = require('../middleware/auth');
const { codeExecutionSchema } = require('../schemas');
const config = require('../config');
const { docker, ensureImage } = require('../lib/docker');
const { materialize } = require('../lib/workspace');
const { IMAGES, buildCmd: buildRunCmd } = require('./run');

const router = express.Router();
router.use(authMiddleware);

// Chaos runs are offline, single-file runs.
const CHAOS_LANGS = new Set(['javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'go', 'rust', 'ruby', 'php', 'bash', 'perl', 'lua']);
const buildCmd = (language, fileName) => ['sh', '-c', buildRunCmd(language, '', fileName, false, false)];

// Chaos scenarios
const SCENARIOS = {
  normal: { label: 'Baseline (no chaos)', memory: 512, cpu: 1.0, killAfterMs: null, network: 'none' },
  mem_limit: { label: 'Memory limit (16MB)', memory: 16, cpu: 1.0, killAfterMs: null, network: 'none' },
  cpu_throttle: { label: 'CPU throttle (5%)', memory: 512, cpu: 0.05, killAfterMs: null, network: 'none' },
  kill_early: { label: 'Process killed at 1s', memory: 512, cpu: 1.0, killAfterMs: 1000, network: 'none' },
  kill_mid: { label: 'Process killed at 3s', memory: 512, cpu: 1.0, killAfterMs: 3000, network: 'none' },
  no_network: { label: 'No network access', memory: 512, cpu: 1.0, killAfterMs: null, network: 'none' },
  disk_limit: { label: 'Disk write limit (1MB tmpfs)', memory: 512, cpu: 1.0, killAfterMs: null, network: 'none', tmpfs: { '/tmp': 'size=1m' }, env: ['TMPDIR=/tmp'] },
  flaky_network: { label: 'Flaky network (drops at 500ms)', memory: 512, cpu: 1.0, killAfterMs: null, network: 'bridge', dropNetworkMs: 500 },
  combined: { label: 'All at once (16MB + 5% CPU + kill 2s)', memory: 16, cpu: 0.05, killAfterMs: 2000, network: 'none' },
};

async function runScenario(code, language, fileName, scenario, userId) {
  const image = IMAGES[language];
  const cmd = buildCmd(language, fileName);
  const cfg = SCENARIOS[scenario] || SCENARIOS.normal;
  let dir;
  let container;
  const start = Date.now();

  try {
    dir = path.join(config.sandboxRoot, `chaos-${crypto.randomUUID()}`);
    await materialize(dir, [{ name: fileName, content: code || '' }]);

    container = await docker.createContainer({
      Image: image,
      Cmd: cmd,
      WorkingDir: '/sandbox',
      Labels: { 'orbit.kind': 'chaos', 'orbit.user': userId },
      HostConfig: {
        PidsLimit: 128,
        Binds: [`${dir}:/sandbox:rw`],
        Memory: cfg.memory * 1024 * 1024,
        NanoCpus: Math.round(cfg.cpu * 1e9),
        AutoRemove: false,
        NetworkMode: cfg.network,
        ...(cfg.tmpfs ? { Tmpfs: cfg.tmpfs } : {})
      },
      ...(cfg.env ? { Env: cfg.env } : {}),
      Tty: false,
    });

    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    let output = '';
    docker.modem.demuxStream(stream, { write: c => { output += c.toString('utf8'); } }, { write: c => { output += c.toString('utf8'); } });
    await container.start();

    let killed = false;
    let killTimeout;
    if (cfg.killAfterMs) {
      killTimeout = setTimeout(async () => {
        killed = true;
        try { await container.stop({ t: 0 }); } catch {}
      }, cfg.killAfterMs);
    }

    const hardTimeout = setTimeout(async () => {
      try { await container.stop({ t: 0 }); } catch {}
    }, 15000);

    let networkTimeout;
    if (cfg.dropNetworkMs) {
      networkTimeout = setTimeout(async () => {
        try {
          const net = docker.getNetwork('bridge');
          await net.disconnect({ Container: container.id, Force: true });
        } catch (e) {}
      }, cfg.dropNetworkMs);
    }

    try { await container.wait(); } catch {}
    clearTimeout(killTimeout);
    clearTimeout(hardTimeout);
    if (networkTimeout) clearTimeout(networkTimeout);

    let category = 'clean-exit';
    try {
      const info = await container.inspect();
      if (info.State.OOMKilled) {
        category = 'oom-killed';
      } else if (info.State.ExitCode !== 0) {
        if (killed) {
          category = cfg.cpu < 1.0 ? 'cpu-starved' : 'timeout';
        } else {
          category = 'runtime-error';
        }
      }
    } catch (e) {
      category = 'runtime-error';
    }

    const elapsed = Date.now() - start;
    const clean = output.trim();

    return {
      scenario: cfg.label,
      output: clean || (killed ? '(process killed — no output)' : '(no output)'),
      elapsed,
      survived: category === 'clean-exit',
      killed,
      category,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      scenario: SCENARIOS[scenario]?.label || scenario,
      output: 'Container error: ' + err.message,
      elapsed,
      survived: false,
      killed: false,
      category: 'runtime-error'
    };
  } finally {
    if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
    if (container) {
      try { await container.remove({ force: true }); } catch {}
    }
  }
}

// POST /api/chaos — runs code against multiple chaos scenarios in parallel
router.post('/', validate(codeExecutionSchema), async (req, res) => {
  const { code, language, fileName } = req.body;
  if (!CHAOS_LANGS.has(language)) {
    return res.status(400).json({ error: `Chaos testing not supported for "${language}"` });
  }

  try {
    await ensureImage(IMAGES[language]);
    const scenarioKeys = Object.keys(SCENARIOS);
    const results = await Promise.all(scenarioKeys.map(key => runScenario(code, language, fileName, key, req.userId)));
    const survivedCount = results.filter(r => r.survived).length;
    const resilienceScore = Math.round((survivedCount / results.length) * 100);

    const memFail = results.find(r => r.scenario === SCENARIOS.mem_limit.label && !r.survived);
    const cpuFail = results.find(r => r.scenario === SCENARIOS.cpu_throttle.label && !r.survived);
    const netFail = results.find(r => r.scenario === SCENARIOS.flaky_network.label && !r.survived);

    const traits = [];
    traits.push(memFail ? 'memory-fragile' : 'memory-resilient');
    traits.push(cpuFail ? 'CPU-fragile' : 'CPU-resilient');
    if (netFail) traits.push('network-fragile');

    const summary = `Your code is ${traits.join(', ')}.`;

    res.json({ results, resilienceScore, total: results.length, survived: survivedCount, summary });
  } catch (err) {
    res.status(500).json({ error: 'Chaos test failed: ' + err.message });
  }
});

module.exports = router;
