// Claude-powered assistant: chat (streamed, with file-editing tools), inline autocomplete and auto-debug.
//
// Claude never touches the project directly. It proposes edits through tool calls
// (write_files / delete_files / run_file); the IDE shows them for review and only
// applies what the user approves.
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const config = require('../config');

const { verifyChanges } = require('./verify');

// Proposed changes are tested in a sandbox; on failure Claude gets the real output and revises.
const MAX_VERIFY_ATTEMPTS = 3;

const client = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', sub: 'Most capable (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', sub: 'Fast and capable' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', sub: 'Fastest, cheapest' },
];
const MODEL_IDS = new Set(MODELS.map(m => m.id));
// Server-side refusal fallback is supported on these; see sendStream().
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const PROJECT_CONTEXT_CHAR_BUDGET = 400_000;

const SYSTEM_INSTRUCTIONS = `You are Orbit, an expert AI pair-programmer built into a browser-based IDE (Orbit IDE).

You can see the user's whole project below. You change it ONLY by calling tools:
- write_files: create or overwrite one or more files. Always send the COMPLETE final content of every file you write — never diffs, placeholders, "..." or "rest unchanged" comments. Use project-relative paths like "src/app.js". Folders are created automatically.
- delete_files: delete files or folders.
- run_file: run a file in the sandbox after the user approves your changes.

Every tool call is shown to the user as a proposal they must approve, so batch related edits into one write_files call. Before calling a tool, write one or two sentences telling the user what you are changing and why — that text is all they see next to the diff. For questions, explanations and reviews, answer in Markdown without tools.

Guidelines:
- Keep each file in the language its extension implies.
- To add dependencies, edit package.json / requirements.txt; the sandbox installs them on run.
- Code runs in Linux containers. Servers must listen on 0.0.0.0 (ports 3000, 5000, 5173, 8000 or 8080 are previewable).
- Never claim you ran code or invent program output.
- Be concise: a short summary of what you changed and why is enough.

Verification: before the user sees your edits, Orbit applies them to a scratch copy of the project and proves they work — it runs the project's tests (npm test, pytest, node --test), or runs the file you pass to run_file, or at least compiles the changed files. If that fails, you get the real output back as the tool result and must fix the problem by calling write_files again (only resend files that need changing). So:
- When you add or change non-trivial logic, also add or update a small test (test_*.py for Python; a "test" script in package.json or *.test.js with node:test for JavaScript).
- Make tests deterministic and fast; never depend on network services or keyboard input.`;

const TOOLS = [
  {
    name: 'write_files',
    description: 'Create or overwrite files in the project. Each entry needs the full final file content.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Project-relative path, e.g. "src/index.js"' },
              content: { type: 'string', description: 'Complete file content' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'delete_files',
    description: 'Delete files or folders (folders are deleted recursively).',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' } } },
      required: ['paths'],
    },
  },
  {
    name: 'run_file',
    description: 'Run a project file in the sandbox (after the user approves any pending changes).',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

const cleanPath = (p) => String(p).trim().replace(/\\/g, '/').replace(/^\.?\/+/, '');
const SafePath = z.string().min(1).max(500).transform(cleanPath)
  .refine(p => p && !p.split('/').includes('..') && !p.includes('\0'), 'invalid path');
const ToolInputs = {
  write_files: z.object({ files: z.array(z.object({ path: z.string(), content: z.string() })).min(1) }),
  delete_files: z.object({ paths: z.array(z.string()).min(1) }),
  run_file: z.object({ path: SafePath }),
};
const safePathOrNull = (p) => { const r = SafePath.safeParse(p); return r.success ? r.data : null; };

class AIError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}

function ensureClient() {
  if (!client) throw new AIError('AI is not configured: set ANTHROPIC_API_KEY on the backend.', 503);
  return client;
}

function friendlyError(err) {
  if (err instanceof AIError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new AIError('The Claude API key is invalid. Check ANTHROPIC_API_KEY on the backend.', 502);
  if (err instanceof Anthropic.PermissionDeniedError) return new AIError('This Claude API key does not have access to that model.', 502);
  if (err instanceof Anthropic.RateLimitError) return new AIError('Claude rate limit reached — try again in a moment.', 429);
  if (err instanceof Anthropic.BadRequestError) return new AIError(`Claude rejected the request: ${err.message}`, 400);
  if (err instanceof Anthropic.APIConnectionError) return new AIError('Could not reach the Claude API from the backend.', 502);
  if (err instanceof Anthropic.APIError) return new AIError(`Claude API error (${err.status}): ${err.message}`, 502);
  return new AIError(err?.message || 'AI request failed');
}

const pickModel = (m) => (MODEL_IDS.has(m) ? m : config.claudeModel);

// Request knobs that differ per model family.
function modelParams(model, effort) {
  if (model.startsWith('claude-haiku-4-5')) return {}; // no adaptive thinking / effort on Haiku 4.5
  return { output_config: { effort } };
}

function projectSnapshot(files, activePath) {
  const tree = files
    .map(f => `${f.isFolder ? '[dir] ' : ''}${f.path ? `${f.path}/` : ''}${f.name}`)
    .sort()
    .join('\n');

  let budget = PROJECT_CONTEXT_CHAR_BUDGET;
  const bodies = [];
  const sorted = files
    .filter(f => !f.isFolder)
    .map(f => ({ rel: f.path ? `${f.path}/${f.name}` : f.name, content: f.content || '' }))
    // Spend the budget on the active file and small files first.
    .sort((a, b) => (a.rel === activePath ? -1 : b.rel === activePath ? 1 : a.content.length - b.content.length));
  for (const f of sorted) {
    if (f.content.length > budget) {
      bodies.push(`<file path="${f.rel}" omitted="true" size="${f.content.length}"/>`);
      continue;
    }
    budget -= f.content.length;
    bodies.push(`<file path="${f.rel}">\n${f.content}\n</file>`);
  }
  return `<project_tree>\n${tree || '(empty project)'}\n</project_tree>\n\n<project_files>\n${bodies.join('\n\n')}\n</project_files>`;
}

// Chat history from the UI -> Messages API turns. The first turn must be from the user.
function toApiMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    const content = String(m.content || '').trim();
    if (!content) continue;
    const role = m.role === 'user' ? 'user' : 'assistant';
    if (!out.length && role !== 'user') continue;
    out.push({ role, content });
  }
  return out;
}

function collectActions(message) {
  const writes = new Map();
  const deletes = new Set();
  let run = null;
  const invalid = [];
  const rejectedPaths = [];
  const accept = (p, fn) => { const safe = safePathOrNull(p); if (safe) fn(safe); else rejectedPaths.push(String(p)); };
  for (const block of message.content) {
    if (block.type !== 'tool_use') continue;
    const schema = ToolInputs[block.name];
    const parsed = schema?.safeParse(block.input);
    if (!parsed?.success) { invalid.push(block.name); continue; }
    if (block.name === 'write_files') parsed.data.files.forEach(f => accept(f.path, p => writes.set(p, f.content)));
    if (block.name === 'delete_files') parsed.data.paths.forEach(p => accept(p, safe => deletes.add(safe)));
    if (block.name === 'run_file') run = parsed.data.path;
  }
  const changes = writes.size || deletes.size
    ? { writes: [...writes].map(([path, content]) => ({ path, content })), deletes: [...deletes] }
    : null;
  return { changes, run, invalid, rejectedPaths };
}

async function sendStream(params, { onText, signal } = {}) {
  const anthropic = ensureClient();
  const request = { ...params };
  if (FALLBACK_MODELS.has(params.model)) {
    // If a safety classifier declines, let the API retry on a suitable fallback model.
    request.betas = ['server-side-fallback-2026-07-01'];
    request.fallbacks = 'default';
  }
  // Tool inputs stream unvalidated (eager_input_streaming), so a malformed one can make the
  // SDK throw a JSON error. Retry those (only those) a couple of times.
  for (let attempt = 0; ; attempt++) {
    const stream = anthropic.beta.messages.stream(request, { signal });
    if (onText) stream.on('text', onText);
    try {
      return await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIError || err?.name === 'AbortError' || signal?.aborted || attempt >= 2) throw err;
      console.warn('Claude tool input was not valid JSON; retrying:', err.message);
    }
  }
}

/**
 * Streamed chat turn. Calls onText(delta) as text arrives and resolves with
 * { reply, changes, run }.
 */
async function chat({ messages, files, activeFile, selection, model, onText, onEvent, signal, verify = false, userId }) {
  const history = toApiMessages(messages);
  if (!history.length || history[history.length - 1].role !== 'user') {
    throw new AIError('The last message must come from the user.', 400);
  }

  // Volatile per-turn context goes into the final user message, after the cached prefix.
  const extras = [];
  if (activeFile?.path) {
    extras.push(`The user is currently looking at "${activeFile.path}".`);
    if (typeof activeFile.content === 'string') {
      extras.push(`Its live editor content (may include unsaved changes):\n<active_file path="${activeFile.path}">\n${activeFile.content}\n</active_file>`);
    }
  }
  if (selection) extras.push(`The user has this code selected:\n<selection>\n${selection}\n</selection>`);
  if (extras.length) {
    const last = history[history.length - 1];
    last.content = `${extras.join('\n\n')}\n\n${last.content}`;
  }

  const chosen = pickModel(model);
  const system = [
    { type: 'text', text: SYSTEM_INSTRUCTIONS },
    { type: 'text', text: projectSnapshot(files, activeFile?.path), cache_control: { type: 'ephemeral' } },
  ];
  const request = (msgs) => sendStream({
    model: chosen,
    max_tokens: 64000,
    ...modelParams(chosen, 'medium'),
    system,
    tools: TOOLS,
    tool_choice: { type: 'auto' },
    messages: msgs,
  }, { onText, signal });

  let convo = history;
  let message = await request(convo);
  const texts = [];
  const merged = { writes: new Map(), deletes: new Set(), run: null };
  const notes = [];
  const attempts = [];

  for (let attempt = 1; ; attempt++) {
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (text) texts.push(text);

    if (message.stop_reason === 'refusal') {
      notes.push('Claude declined to continue with this request.');
      break;
    }
    if (message.stop_reason === 'max_tokens' && message.content.some(b => b.type === 'tool_use')) {
      notes.push('⚠ The response was cut off before the file edits were complete. Ask for fewer files at a time.');
      break;
    }

    const { changes, run, invalid, rejectedPaths } = collectActions(message);
    if (invalid.length) notes.push(`⚠ Ignored ${invalid.length} malformed tool call(s).`);
    if (rejectedPaths.length) notes.push(`⚠ Skipped unsafe path(s) outside the project: ${rejectedPaths.join(', ')}`);
    // Later attempts refine earlier ones: a file written again replaces the earlier version.
    for (const w of changes?.writes || []) { merged.writes.set(w.path, w.content); merged.deletes.delete(w.path); }
    for (const d of changes?.deletes || []) { merged.deletes.add(d); merged.writes.delete(d); }
    if (run) merged.run = run;

    if (!verify || !changes) break;

    // ── Prove the accumulated changes work ──
    const current = { writes: [...merged.writes].map(([path, content]) => ({ path, content })), deletes: [...merged.deletes] };
    onEvent?.({ type: 'verify', phase: 'start', attempt });
    const result = await verifyChanges({ files, changes: current, runPath: merged.run, signal, userId });
    attempts.push({ attempt, ...result });
    onEvent?.({ type: 'verify', phase: 'result', attempt, ...result });
    if (result.status !== 'failed' || attempt >= MAX_VERIFY_ATTEMPTS || signal?.aborted) break;

    // ── Feed the real failure back so Claude can fix it ──
    const toolUses = message.content.filter(b => b.type === 'tool_use');
    const failure = `Your changes were applied to a scratch copy of the project and checked with \`${result.label}\`. It FAILED (${result.summary}).

Output (last part):
${result.output.slice(-5000)}

Find the root cause and fix it by calling write_files again with the corrected full content of every file that needs to change. Files you don't resend keep the version you already proposed.`;
    const toolResults = toolUses.map((b, i) => ({
      type: 'tool_result',
      tool_use_id: b.id,
      is_error: i === 0,
      content: i === 0 ? failure : 'Recorded.',
    }));
    convo = [...convo, { role: 'assistant', content: message.content }, { role: 'user', content: toolResults }];
    onEvent?.({ type: 'verify', phase: 'revising', attempt });
    onText?.('\n\n');
    message = await request(convo);
  }

  const finalChanges = merged.writes.size || merged.deletes.size
    ? { writes: [...merged.writes].map(([path, content]) => ({ path, content })), deletes: [...merged.deletes] }
    : null;
  let reply = [...texts, ...notes].join('\n\n');
  if (!reply) {
    reply = finalChanges
      ? `Proposed changes to ${[...finalChanges.writes.map(w => w.path), ...finalChanges.deletes].map(p => `\`${p}\``).join(', ')}.`
      : merged.run ? `Running ${merged.run}…` : 'Done.';
  }
  const last = attempts[attempts.length - 1];
  const verification = attempts.length ? { status: last.status, summary: last.summary, label: last.label, kind: last.kind, output: last.output, attempts: attempts.map(a => ({ attempt: a.attempt, status: a.status, summary: a.summary, label: a.label, durationMs: a.durationMs })) } : null;
  return { reply, changes: finalChanges, run: merged.run, model: message.model, verification };
}

/** Prove the project's current state (no proposed changes): runs its tests or checks. */
async function verifyProject({ files, runPath, signal, userId }) {
  const all = files.filter(f => !f.isFolder).map(f => (f.path ? `${f.path}/${f.name}` : f.name));
  return verifyChanges({ files, changes: { writes: [], deletes: [] }, runPath, signal, userId, changedPaths: all });
}

/** Fix code given a real error from the sandbox. Resolves with { changes, explanation }. */
async function debug({ files, file, language, error }) {
  const message = await sendStream({
    model: config.claudeModel,
    max_tokens: 32000,
    ...modelParams(config.claudeModel, 'medium'),
    system: [
      { type: 'text', text: SYSTEM_INSTRUCTIONS },
      { type: 'text', text: projectSnapshot(files, file.path), cache_control: { type: 'ephemeral' } },
    ],
    tools: TOOLS.filter(t => t.name === 'write_files'),
    tool_choice: { type: 'auto' },
    messages: [{
      role: 'user',
      content: `Running "${file.path}" (${language}) failed in the sandbox with this real output:\n<error>\n${error}\n</error>\n\nFind the root cause and fix it with write_files (add missing dependencies to package.json / requirements.txt if that is the problem). Then explain the fix in one or two sentences.`,
    }],
  });
  const explanation = message.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const { changes } = collectActions(message);
  return { changes, explanation };
}

/** Inline completion between prefix and suffix. Resolves with a string (possibly empty). */
async function autocomplete({ prefix, suffix, language, signal }) {
  const anthropic = ensureClient();
  const model = config.claudeFastModel;
  const response = await anthropic.messages.create({
    model,
    max_tokens: 200,
    ...modelParams(model, 'low'),
    system: `You are a code completion engine for ${language}. Output ONLY the code that should be inserted at <CURSOR>: no explanations, no markdown fences, no repetition of the surrounding code. Prefer completing the current line or block; at most ~10 lines. Output nothing if no completion makes sense.`,
    messages: [{ role: 'user', content: `${prefix.slice(-6000)}<CURSOR>${suffix.slice(0, 2000)}` }],
  }, { signal });
  let text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  text = text.replace(/^```[\w-]*\n?/, '').replace(/\n?```\s*$/, '');
  return text;
}

module.exports = { chat, debug, autocomplete, verifyProject, friendlyError, AIError, MODELS, enabled: () => !!client };
