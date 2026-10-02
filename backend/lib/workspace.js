// Keeps an on-disk copy of each project under WORKSPACE_ROOT/<projectId> so the terminal,
// git and editor all see the same files. The database stays the source of truth for the
// editor; changes made from the terminal are scanned back into the database.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const prisma = require('../db');
const config = require('../config');
const { safeJoin, joinRel } = require('./paths');
const { docs } = require('y-websocket/bin/utils');

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'env', 'dist', 'build',
  '.next', '.nuxt', '.cache', 'target', 'coverage', '.idea', '.vscode',
]);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 2000;

const LANG_BY_EXT = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby',
  php: 'php', sh: 'bash', pl: 'perl', lua: 'lua', r: 'r', md: 'markdown', json: 'json',
  css: 'css', html: 'html', yml: 'yaml', yaml: 'yaml', sql: 'sql', txt: 'plaintext',
};
const languageFor = (name) => LANG_BY_EXT[name.split('.').pop().toLowerCase()] || 'plaintext';

function workspaceDir(projectId) {
  return safeJoin(config.workspaceRoot, projectId);
}

function workspaceExists(projectId) {
  return fs.existsSync(workspaceDir(projectId));
}

// Push new content into a live collaborative document, if anyone has it open.
// Never creates a doc (y-websocket's getYDoc would, and leak memory).
function updateLiveDoc(projectId, fileId, content) {
  const doc = docs.get(`${projectId}-${fileId}`);
  if (!doc) return;
  const ytext = doc.getText('monaco');
  if (ytext.toString() === content) return;
  doc.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, content || '');
  });
}

// Write every DB file to disk. Non-destructive: files that only exist on disk
// (node_modules, build output, files made in the terminal) are left alone.
async function syncToDisk(projectId) {
  const dir = workspaceDir(projectId);
  await fsp.mkdir(dir, { recursive: true });
  const files = await prisma.file.findMany({ where: { projectId } });
  for (const f of files) {
    const target = safeJoin(dir, f.path, f.name);
    if (f.isFolder) {
      await fsp.mkdir(target, { recursive: true });
      continue;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const current = await fsp.readFile(target, 'utf8').catch(() => null);
    if (current !== f.content) await fsp.writeFile(target, f.content || '');
  }
  return dir;
}

// Mirror a single editor change to disk if the workspace has been materialized.
async function writeEntry(projectId, file) {
  if (!workspaceExists(projectId)) return;
  try {
    const target = safeJoin(workspaceDir(projectId), file.path, file.name);
    if (file.isFolder) return void (await fsp.mkdir(target, { recursive: true }));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, file.content || '');
  } catch (e) {
    console.error('workspace write failed:', e.message);
  }
}

async function removeEntry(projectId, relPath) {
  if (!workspaceExists(projectId)) return;
  try {
    await fsp.rm(safeJoin(workspaceDir(projectId), relPath), { recursive: true, force: true });
  } catch (e) {
    console.error('workspace remove failed:', e.message);
  }
}

async function renameEntry(projectId, fromRel, toRel) {
  if (!workspaceExists(projectId)) return;
  try {
    const dir = workspaceDir(projectId);
    const to = safeJoin(dir, toRel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(safeJoin(dir, fromRel), to);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('workspace rename failed:', e.message);
  }
}

// Walk the workspace (skipping dependency/build dirs) and return text files + folders.
async function walk(dir) {
  const files = [];
  const folders = [];
  async function visit(rel) {
    const entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        folders.push(childRel);
        await visit(childRel);
      } else if (e.isFile()) {
        const stat = await fsp.stat(path.join(dir, childRel)).catch(() => null);
        if (!stat || stat.size > MAX_FILE_BYTES) continue;
        files.push({ rel: childRel, mtimeMs: stat.mtimeMs, size: stat.size });
      }
    }
  }
  await visit('');
  return { files, folders };
}

const isBinary = (buf) => buf.subarray(0, 8000).includes(0);
const splitRel = (rel) => {
  const i = rel.lastIndexOf('/');
  return i === -1 ? { path: '', name: rel } : { path: rel.slice(0, i), name: rel.slice(i + 1) };
};

// Bring changes made on disk (e.g. from the terminal) into the database.
//
// The editor writes to the database first and the disk second, so "disk differs from DB"
// does NOT mean the disk is newer. Rules that keep the editor from losing edits:
//   - `changedPaths`: only look at files whose mtime changed since the last scan (null = all,
//     used by the manual "sync" button).
//   - Never overwrite a DB row that was updated after the file's mtime (last writer wins).
//   - Only delete rows for `removedPaths` (files that existed on the previous scan and are gone
//     now), or, for a full import, rows that are missing on disk and not recently touched.
// Returns true if anything changed.
async function importFromDisk(projectId, { changedPaths = null, removedPaths = null } = {}) {
  const dir = workspaceDir(projectId);
  if (!fs.existsSync(dir)) return false;
  const { files, folders } = await walk(dir);
  const existing = await prisma.file.findMany({ where: { projectId } });
  const byRel = new Map(existing.map(f => [joinRel(f.path, f.name), f]));
  const wanted = (rel) => !changedPaths || changedPaths.has(rel);
  let changed = false;

  for (const rel of folders) {
    if (byRel.has(rel) || !wanted(rel + '/')) continue;
    const { path: p, name } = splitRel(rel);
    await prisma.file.create({ data: { projectId, path: p, name, isFolder: true, language: '', content: '' } })
      .then(() => { changed = true; }).catch(() => {});
  }

  for (const f of files) {
    if (!wanted(f.rel)) continue;
    const row = byRel.get(f.rel);
    if (row?.isFolder) continue;
    if (row && row.updatedAt.getTime() >= f.mtimeMs) continue; // the editor saved more recently
    const buf = await fsp.readFile(path.join(dir, f.rel)).catch(() => null);
    if (!buf || isBinary(buf)) continue;
    const content = buf.toString('utf8');
    if (row) {
      if (row.content === content) continue;
      // Conditional update: skip if the editor saved in the meantime.
      const res = await prisma.file.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { content } });
      if (res.count) { updateLiveDoc(projectId, row.id, content); changed = true; }
    } else {
      const { path: p, name } = splitRel(f.rel);
      await prisma.file.create({ data: { projectId, path: p, name, isFolder: false, language: languageFor(name), content } })
        .then(() => { changed = true; }).catch(() => {});
    }
  }

  const onDisk = new Set([...files.map(f => f.rel), ...folders]);
  const recent = Date.now() - 15000;
  const stale = existing.filter(f => {
    const rel = joinRel(f.path, f.name);
    if (onDisk.has(rel)) return false;
    if (removedPaths ? !removedPaths.has(f.isFolder ? rel + '/' : rel) : f.updatedAt.getTime() > recent) return false;
    // Don't delete things we deliberately skip (ignored dirs, oversized/binary files).
    if (rel.split('/').some(seg => IGNORED_DIRS.has(seg))) return false;
    return !fs.existsSync(path.join(dir, rel));
  });
  if (stale.length) {
    await prisma.file.deleteMany({ where: { id: { in: stale.map(f => f.id) } } });
    changed = true;
  }

  if (changed) await prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } }).catch(() => {});
  return changed;
}

// While a terminal is open, poll the workspace for changes and import them.
// Polling (rather than fs.watch) keeps inotify usage flat no matter how big node_modules gets.
const scanners = new Map(); // projectId -> { refs, timer, snapshot, onChange }

function startScanner(projectId, onChange) {
  let s = scanners.get(projectId);
  if (s) { s.refs += 1; s.listeners.add(onChange); return; }
  s = { refs: 1, snapshot: null, listeners: new Set([onChange]), busy: false };
  const tick = async () => {
    if (s.busy) return;
    s.busy = true;
    try {
      const { files, folders } = await walk(workspaceDir(projectId));
      const sig = new Map(files.map(f => [f.rel, `${f.mtimeMs}:${f.size}`]));
      folders.forEach(d => sig.set(d + '/', 'dir'));
      const previous = s.snapshot;
      s.snapshot = sig;
      if (!previous) return; // first pass only records the baseline
      const changedPaths = new Set([...sig].filter(([k, v]) => previous.get(k) !== v).map(([k]) => k));
      const removedPaths = new Set([...previous.keys()].filter(k => !sig.has(k)));
      if (!changedPaths.size && !removedPaths.size) return;
      if (await importFromDisk(projectId, { changedPaths, removedPaths })) s.listeners.forEach(fn => fn());
    } catch (e) {
      console.error('workspace scan failed:', e.message);
    } finally {
      s.busy = false;
    }
  };
  tick(); // baseline right away, so changes made in the first seconds aren't missed
  s.timer = setInterval(tick, 2500);
  scanners.set(projectId, s);
}

function stopScanner(projectId, onChange) {
  const s = scanners.get(projectId);
  if (!s) return;
  s.listeners.delete(onChange);
  s.refs -= 1;
  if (s.refs <= 0) {
    clearInterval(s.timer);
    scanners.delete(projectId);
  }
}

// Write a list of {name, path, isFolder, content} into a fresh directory (used by sandboxes).
async function materialize(dir, entries) {
  await fsp.mkdir(dir, { recursive: true });
  for (const f of entries) {
    const target = safeJoin(dir, f.path, f.name);
    if (f.isFolder) { await fsp.mkdir(target, { recursive: true }); continue; }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, f.content || '');
  }
}

module.exports = {
  workspaceDir, workspaceExists, syncToDisk, writeEntry, removeEntry, renameEntry,
  importFromDisk, startScanner, stopScanner, updateLiveDoc, materialize, languageFor, IGNORED_DIRS,
};
