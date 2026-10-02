const path = require('path');

// Resolve `parts` under `root`, refusing anything that escapes it ("../", absolute paths, NUL bytes).
function safeJoin(root, ...parts) {
  const rel = path.join(...parts.map(p => String(p || '')));
  if (rel.includes('\0')) throw new Error('Invalid path');
  const full = path.resolve(root, rel);
  const normRoot = path.resolve(root);
  if (full !== normRoot && !full.startsWith(normRoot + path.sep)) {
    throw new Error(`Path escapes project root: ${rel}`);
  }
  return full;
}

// "a/b" + "c.js" -> "a/b/c.js"
function joinRel(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

// Quote a value for safe interpolation into an `sh -c` string.
function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

module.exports = { safeJoin, joinRel, shQuote };
