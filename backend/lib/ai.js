// Claude-powered assistant: chat (streamed, with file-editing tools), inline autocomplete and auto-debug.
//
// Claude never touches the project directly. It proposes edits through tool calls
// (write_files / delete_files / run_file); the IDE shows them for review and only
// applies what the user approves.
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const config = require('../config');

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
- Be concise: a short summary of what you changed and why is enough.`;

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
async function chat({ messages, files, activeFile, selection, model, onText, signal }) {
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
  const message = await sendStream({
    model: chosen,
    max_tokens: 64000,
    ...modelParams(chosen, 'medium'),
    system: [
      { type: 'text', text: SYSTEM_INSTRUCTIONS },
      { type: 'text', text: projectSnapshot(files, activeFile?.path), cache_control: { type: 'ephemeral' } },
    ],
    tools: TOOLS,
    tool_choice: { type: 'auto' },
    messages: history,
  }, { onText, signal });

  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

  if (message.stop_reason === 'refusal') {
    return { reply: text || 'Claude declined to help with this request.', changes: null, run: null };
  }
  const hasTool = message.content.some(b => b.type === 'tool_use');
  if (message.stop_reason === 'max_tokens' && hasTool) {
    return { reply: `${text}\n\n⚠ The response was cut off before the file edits were complete. Ask for fewer files at a time.`.trim(), changes: null, run: null };
  }

  const { changes, run, invalid, rejectedPaths } = collectActions(message);
  let reply = text;
  if (invalid.length) reply += `\n\n⚠ Ignored ${invalid.length} malformed tool call(s).`;
  if (rejectedPaths.length) reply += `\n\n⚠ Skipped unsafe path(s) outside the project: ${rejectedPaths.join(', ')}`;
  if (!reply) {
    reply = changes
      ? `Proposed changes to ${[...changes.writes.map(w => w.path), ...changes.deletes].map(p => `\`${p}\``).join(', ')}.`
      : run ? `Running ${run}…` : 'Done.';
  }
  return { reply, changes, run, model: message.model };
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

module.exports = { chat, debug, autocomplete, friendlyError, AIError, MODELS, enabled: () => !!client };
