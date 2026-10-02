// Verification ("Proof"): apply a set of proposed changes to a throwaway copy of the project,
// then prove they work by running the project's tests, running the target program, or at
// least compiling/syntax-checking the changed files. Nothing touches the real project.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { docker, dockerAvailable, ensureImage } = require('./docker');
const { materialize } = require('./workspace');
const { shQuote, joinRel } = require('./paths');

const IMAGES = {
  node: 'node:20-alpine',
  python: 'python:3.12-alpine',
  java: 'eclipse-temurin:21-jdk-alpine',
  gcc: 'gcc:13-bookworm',
  go: 'golang:1.22-alpine',
  rust: 'rust:1.78-slim',
  ruby: 'ruby:3.3-alpine',
  php: 'php:8.3-cli-alpine',
};
const TIMEOUT = { tests: 180_000, run: 25_000, compile: 90_000 };
const RUN_ALIVE_MS = 8_000; // a program still running after this long (e.g. a server) counts as started OK
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const ext = (p) => p.split('.').pop().toLowerCase();

// Project files (from the DB) with the proposed writes/deletes overlaid.
function overlay(files, changes) {
  const map = new Map();
  for (const f of files) if (!f.isFolder) map.set(joinRel(f.path, f.name), f.content || '');
  for (const d of changes?.deletes || []) {
    for (const key of [...map.keys()]) if (key === d || key.startsWith(d + '/')) map.delete(key);
  }
  for (const w of changes?.writes || []) map.set(w.path, w.content);
  return map;
}

const NO_TEST_SCRIPT = /no test specified/;

// Decide how to prove the change works. Returns null when there's nothing meaningful to check.
function plan(map, changedPaths, runPath) {
  const has = (p) => map.has(p);
  const paths = [...map.keys()];

  // 1. Tests
  if (has('package.json')) {
    let pkg = {};
    try { pkg = JSON.parse(map.get('package.json')); } catch { /* invalid json is caught by npm */ }
    const script = pkg.scripts?.test;
    if (script && !NO_TEST_SCRIPT.test(script)) {
      return { kind: 'tests', label: 'npm test', image: IMAGES.node, network: true, env: ['CI=true'],
        cmd: 'npm install --no-audit --no-fund --loglevel=error && npm test' };
    }
  }
  const pyTests = paths.filter(p => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(p));
  if (pyTests.length) {
    const req = has('requirements.txt') ? '-r requirements.txt' : '';
    return { kind: 'tests', label: 'pytest', image: IMAGES.python, network: true,
      cmd: `pip install -q --disable-pip-version-check pytest ${req} 2>&1 | tail -3; python -m pytest -q --color=no -p no:cacheprovider` };
  }
  const jsTests = paths.filter(p => /\.(test|spec)\.(m?js|cjs)$/.test(p) && !p.includes('node_modules'));
  if (jsTests.length && !has('package.json')) {
    return { kind: 'tests', label: 'node --test', image: IMAGES.node, network: false,
      cmd: `node --test ${jsTests.map(shQuote).join(' ')}` };
  }

  // 2. Run the program Claude wants to run
  if (runPath && map.has(runPath)) {
    const dir = runPath.includes('/') ? runPath.slice(0, runPath.lastIndexOf('/')) : '';
    const file = runPath.split('/').pop();
    const cd = `cd /sandbox/${dir ? shQuote(dir) : ''}`;
    const base = file.replace(/\.[^.]+$/, '');
    const e = ext(file);
    const runners = {
      js: [IMAGES.node, `${has('package.json') ? 'npm install --no-audit --no-fund --loglevel=error && ' : ''}${cd} && node ${shQuote(file)}`],
      mjs: [IMAGES.node, `${cd} && node ${shQuote(file)}`],
      py: [IMAGES.python, `${has('requirements.txt') ? 'pip install -q --disable-pip-version-check -r requirements.txt && ' : ''}${cd} && python3 -u ${shQuote(file)}`],
      java: [IMAGES.java, `${cd} && javac ${shQuote(file)} && java ${shQuote(base)}`],
      c: [IMAGES.gcc, `${cd} && gcc ${shQuote(file)} -o /tmp/out -lm && /tmp/out`],
      cpp: [IMAGES.gcc, `${cd} && g++ ${shQuote(file)} -o /tmp/out && /tmp/out`],
      go: [IMAGES.go, `${cd} && go run ${shQuote(file)}`],
      rb: [IMAGES.ruby, `${cd} && ruby ${shQuote(file)}`],
      php: [IMAGES.php, `${cd} && php ${shQuote(file)}`],
    };
    if (runners[e]) {
      return { kind: 'run', label: `run ${runPath}`, image: runners[e][0], network: true, cmd: runners[e][1] };
    }
  }

  // 3. Compile / syntax-check what changed
  const changed = changedPaths.filter(p => map.has(p));
  const byExt = (...exts) => changed.filter(p => exts.includes(ext(p)));
  const py = byExt('py');
  if (py.length) return { kind: 'compile', label: 'python -m py_compile', image: IMAGES.python, network: false, cmd: `python -m py_compile ${py.map(shQuote).join(' ')}` };
  const js = byExt('js', 'mjs', 'cjs');
  if (js.length) return { kind: 'compile', label: 'node --check', image: IMAGES.node, network: false, cmd: js.map(f => `node --check ${shQuote(f)}`).join(' && ') };
  const c = byExt('c');
  if (c.length) return { kind: 'compile', label: 'gcc -fsyntax-only', image: IMAGES.gcc, network: false, cmd: `gcc -fsyntax-only ${c.map(shQuote).join(' ')}` };
  const cpp = byExt('cpp', 'cc', 'cxx');
  if (cpp.length) return { kind: 'compile', label: 'g++ -fsyntax-only', image: IMAGES.gcc, network: false, cmd: `g++ -fsyntax-only ${cpp.map(shQuote).join(' ')}` };
  const java = byExt('java');
  if (java.length) return { kind: 'compile', label: 'javac', image: IMAGES.java, network: false, cmd: `mkdir -p /tmp/classes && javac -d /tmp/classes ${java.map(shQuote).join(' ')}` };
  const rb = byExt('rb');
  if (rb.length) return { kind: 'compile', label: 'ruby -c', image: IMAGES.ruby, network: false, cmd: rb.map(f => `ruby -c ${shQuote(f)}`).join(' && ') };
  const php = byExt('php');
  if (php.length) return { kind: 'compile', label: 'php -l', image: IMAGES.php, network: false, cmd: php.map(f => `php -l ${shQuote(f)}`).join(' && ') };
  const json = byExt('json');
  if (json.length) return { kind: 'compile', label: 'JSON parse', image: IMAGES.node, network: false, cmd: json.map(f => `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" ${shQuote(f)}`).join(' && ') };
  return null;
}

// One-line summary like "6 passed" from common test runners' output.
function summarize(kind, output, passed) {
  if (kind === 'tests') {
    const patterns = [
      /Tests:\s+([^\n]+)/,                                       // jest
      /(\d+ (?:failed|passed)(?:, \d+ (?:failed|passed|skipped|errors?))*)\s+in\s+[\d.]+s/, // pytest
      /# pass (\d+)[\s\S]*?# fail (\d+)/,                        // node --test
      /Ran (\d+ tests?)[\s\S]*?\n(OK|FAILED[^\n]*)/,             // unittest
      /(\d+ passing)(?:[\s\S]*?(\d+ failing))?/,                 // mocha
    ];
    for (const re of patterns) {
      const m = output.match(re);
      if (!m) continue;
      if (re.source.startsWith('# pass')) return `${m[1]} passed, ${m[2]} failed`;
      return m.slice(1).filter(Boolean).join(', ').trim();
    }
    return passed ? 'tests passed' : 'tests failed';
  }
  if (kind === 'run') return passed ? 'ran without errors' : 'program crashed';
  return passed ? 'compiles cleanly' : 'does not compile';
}

/**
 * Prove a set of changes. Resolves with
 *   { status: 'passed'|'failed'|'skipped', kind, label, summary, output, durationMs }
 */
async function verifyChanges({ files, changes, runPath, signal, userId, changedPaths: checkPaths }) {
  const started = Date.now();
  if (!(await dockerAvailable())) {
    return { status: 'skipped', kind: null, label: '', summary: 'Docker is not available, so the change could not be tested.', output: '', durationMs: 0 };
  }
  const map = overlay(files, changes);
  const changedPaths = checkPaths || (changes?.writes || []).map(w => w.path);
  const p = plan(map, changedPaths, runPath);
  if (!p) {
    return { status: 'skipped', kind: null, label: '', summary: 'Nothing to test: no tests, runnable entry point or checkable code in this change.', output: '', durationMs: 0 };
  }

  const dir = path.join(config.sandboxRoot, `verify-${crypto.randomUUID()}`);
  let container;
  try {
    await materialize(dir, [...map].map(([rel, content]) => {
      const i = rel.lastIndexOf('/');
      return { name: i === -1 ? rel : rel.slice(i + 1), path: i === -1 ? '' : rel.slice(0, i), content };
    }));
    await ensureImage(p.image);
    container = await docker.createContainer({
      Image: p.image,
      Cmd: ['sh', '-c', p.cmd],
      WorkingDir: '/sandbox',
      Env: ['PYTHONUNBUFFERED=1', 'NO_COLOR=1', 'FORCE_COLOR=0', ...(p.env || [])],
      Labels: { 'orbit.kind': 'verify', ...(userId ? { 'orbit.user': userId } : {}) },
      Tty: false,
      OpenStdin: false, // programs that read input get EOF instead of hanging
      HostConfig: {
        Binds: [`${dir}:/sandbox:rw`],
        Memory: 768 * 1024 * 1024,
        NanoCpus: 1.5e9,
        PidsLimit: 256,
        SecurityOpt: ['no-new-privileges'],
        NetworkMode: p.network ? 'bridge' : 'none',
      },
    });
    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    let output = '';
    const sink = { write: (c) => { if (output.length < 400_000) output += c.toString('utf8'); } };
    docker.modem.demuxStream(stream, sink, sink);
    await container.start();

    const abort = () => container.kill().catch(() => {});
    signal?.addEventListener('abort', abort, { once: true });

    let stillRunning = false;
    const waitLimit = p.kind === 'run' ? RUN_ALIVE_MS : TIMEOUT[p.kind];
    const exited = await Promise.race([
      container.wait().then(r => r.StatusCode),
      new Promise(resolve => setTimeout(() => resolve(null), waitLimit)),
    ]);
    if (exited === null) { stillRunning = true; await container.kill().catch(() => {}); }
    signal?.removeEventListener('abort', abort);

    output = output.replace(ANSI, '').replace(/\r/g, '');
    let status;
    let summary;
    if (stillRunning && p.kind === 'run') {
      status = 'passed';
      summary = `started and kept running for ${RUN_ALIVE_MS / 1000}s (e.g. a server) without crashing`;
    } else if (stillRunning) {
      status = 'failed';
      summary = `timed out after ${Math.round(waitLimit / 1000)}s`;
    } else if (exited !== 0 && p.kind === 'run' && /EOFError|NoSuchElementException|EOF when reading/.test(output)) {
      // The program waited for keyboard input; it got this far without errors.
      status = 'passed';
      summary = 'started fine (stopped where it waits for keyboard input)';
    } else {
      status = exited === 0 ? 'passed' : 'failed';
      summary = summarize(p.kind, output, status === 'passed');
    }
    return { status, kind: p.kind, label: p.label, summary, output: output.slice(-8000), durationMs: Date.now() - started };
  } catch (err) {
    return { status: 'skipped', kind: p.kind, label: p.label, summary: `Could not run the check: ${err.message}`, output: '', durationMs: Date.now() - started };
  } finally {
    if (container) container.remove({ force: true }).catch(() => {});
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

module.exports = { verifyChanges, plan, overlay, summarize };
