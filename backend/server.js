require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const os = require('os');
const Docker = require('dockerode');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const rateLimit = require('express-rate-limit');
const validate = require('./middleware/validate');
const { aiChatSchema, codeExecutionSchema } = require('./schemas');

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');

const chatRoutes = require('./routes/chats');
const runRoutes = require('./routes/run');
const chaosRoutes = require('./routes/chaos');
const gitRoutes = require('./routes/git');

const app = express();
const server = http.createServer(app);
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const io = new Server(server, { cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] } });
app.set('io', io);

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

const dockerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many execution requests, please try again in a minute' }
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', generalLimiter, projectRoutes);
app.use('/api/projects/:projectId/git', generalLimiter, gitRoutes);
app.use('/api/projects/:projectId/chats', generalLimiter, chatRoutes);
app.use('/api/chats', generalLimiter, chatRoutes);

app.use('/api/run', dockerLimiter, runRoutes);
app.use('/api/chaos', dockerLimiter, chaosRoutes);
app.use('/api/containers', dockerLimiter);

app.get('/api/containers/list', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    res.json({ containers });
  } catch (err) { res.status(500).json({ error: 'Failed to list containers.' }); }
});

app.post('/api/containers/:id/start', async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.start();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to start container.' }); }
});

app.post('/api/containers/:id/stop', async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.stop();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to stop container.' }); }
});

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

app.post('/api/ai/chat', generalLimiter, validate(aiChatSchema), async (req, res) => {
  const { messages, fileTree, activeFile, model } = req.body;

  const treeListing = (fileTree || [])
    .map(f => `${f.isFolder ? '[folder]' : '[file]'} ${f.path ? f.path + '/' : ''}${f.name}`)
    .join('\n');

  const systemPrompt = `You are an expert AI coding agent embedded in a web IDE, like GitHub Copilot or Cursor — but more capable: you can create entire multi-file projects in one response, not just edit one file.

PROJECT STRUCTURE:
${treeListing || '(empty project)'}

ACTIVE FILE: ${activeFile ? (activeFile.path ? activeFile.path + '/' : '') + activeFile.name : 'none'}
${activeFile ? `ACTIVE FILE CONTENT:\n${activeFile.content}` : ''}

RESPONSE FORMAT — choose exactly ONE of these four modes:

MODE 1 — Multi-file Edit / Scaffold (use when asked to create, set up, OR update multiple files at once, e.g., HTML + CSS + JS):
Respond with ONLY a JSON object, nothing else, no markdown fences:
{"mode":"scaffold","reply":"one line summary of work done","items":[{"name":"server.js","path":"","isFolder":false,"language":"javascript","content":"...full file content..."},{"name":"routes","path":"","isFolder":true},{"name":"users.js","path":"routes","isFolder":false,"language":"javascript","content":"..."}]}

MODE 2 — Single File Edit (use ONLY for fixing or updating exactly ONE file, the currently active file):
Respond with a brief summary of the work done, followed by a single markdown code block containing the COMPLETE updated file content.

MODE 3 — Run a file or answer a question:
For run requests, respond with exactly: RUN_FILE:<filename>
For questions, answer concisely in plain text using the real context above.

MODE 4 — Delete file(s):
Respond with ONLY a JSON object, nothing else, no markdown fences:
{"mode":"delete","reply":"summary of deletion","items":["filename1.js", "path/folder2"]}

RULES:
- Match file extensions to file content language exactly (.js=JavaScript only, .py=Python only, etc.)
- NEVER fabricate output or claim you executed code.
- For scaffolding, YOU MUST OUTPUT THE ENTIRE WORKING SOURCE CODE FOR EVERY FILE in the "content" field. DO NOT leave the "content" field empty. NO STUBS.
- For scaffolding, IMPORTANT: "name" must ONLY be the filename (e.g., "index.html"). Do NOT include the folder path in "name". Put the folder in "path" (e.g., "public").
- DO NOT suggest running 'npm install'. To add dependencies, use MODE 1 to scaffold a 'package.json' file.
- CRITICAL: If you are creating or updating multiple files, you MUST output them as separate entities (either via MODE 1 JSON, or as SEPARATE markdown code blocks). NEVER combine multiple files (like HTML, CSS, JS) into a single code block.
- If using markdown code blocks, ALWAYS include the exact filename on the very first line of the code block as a comment (e.g. `// style.css` or `<!-- index.html -->`).`;


  let historyRaw = (messages || []).slice(0, -1);
  const firstUserIndex = historyRaw.findIndex(m => m.role === 'user');
  historyRaw = firstUserIndex >= 0 ? historyRaw.slice(firstUserIndex) : [];
  const history = historyRaw.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
  const lastUserMessage = messages?.[messages.length - 1]?.content || '';

  function parseReply(reply) {
    const trimmed = reply.trim();
    if (trimmed.startsWith('RUN_FILE:')) {
      return { reply: 'Running...', action: 'run', fileName: trimmed.replace('RUN_FILE:', '').trim() };
    }
    
    let jsonMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    let jsonStr = jsonMatch ? jsonMatch[1] : trimmed;
    
    // Try to parse scaffold JSON
    if (jsonStr.includes('"mode"') && jsonStr.includes('"scaffold"')) {
       try {
         const firstBrace = jsonStr.indexOf('{');
         const lastBrace = jsonStr.lastIndexOf('}');
         if (firstBrace !== -1 && lastBrace > firstBrace) {
           const parsed = JSON.parse(jsonStr.substring(firstBrace, lastBrace + 1));
           if (parsed.mode === 'scaffold' && Array.isArray(parsed.items)) {
             return { reply: parsed.reply || 'Scaffolding project...', action: 'scaffold', items: parsed.items };
           }
         }
       } catch (e) {}
    }

    // Try delete
    if (jsonStr.includes('"mode"') && jsonStr.includes('"delete"')) {
      try {
         const firstBrace = jsonStr.indexOf('{');
         const lastBrace = jsonStr.lastIndexOf('}');
         if (firstBrace !== -1 && lastBrace > firstBrace) {
           const parsed = JSON.parse(jsonStr.substring(firstBrace, lastBrace + 1));
           if (parsed.mode === 'delete' && Array.isArray(parsed.items)) {
             return { reply: parsed.reply || 'Deleting files...', action: 'delete', items: parsed.items };
           }
         }
      } catch (e) {}
    }

    const codeBlocks = [...reply.matchAll(/```(\w+)?\n([\s\S]*?)```/g)];
    if (codeBlocks.length > 1) {
      const items = codeBlocks.map((match) => {
         const lang = match[1] || 'text';
         let code = match[2];
         let name = '';
         
         const beforeBlock = reply.substring(0, match.index).trim();
         const linesBefore = beforeBlock.split('\n');
         const lastLineBefore = linesBefore[linesBefore.length - 1].trim();
         const nameMatch = lastLineBefore.match(/`?([a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+)`?/);
         
         if (nameMatch) {
            name = nameMatch[1];
         } else {
            const firstLine = code.split('\n')[0].trim();
            if (firstLine.startsWith('//') || firstLine.startsWith('/*') || firstLine.startsWith('<!--')) {
               const potentialName = firstLine.replace(/[\/\\*<!>\-]/g, '').trim();
               if (potentialName && potentialName.includes('.')) {
                   name = potentialName.split(' ')[0];
                   code = code.substring(code.indexOf('\n') + 1);
               }
            }
         }
         
         if (!name) name = `file_${Math.random().toString(36).slice(2,8)}.${lang === 'javascript' ? 'js' : lang}`;
         return { name, path: '', isFolder: false, language: lang, content: code.trim() };
      });
      return { reply: 'Extracted multiple files...', action: 'scaffold', items };
    } else if (codeBlocks.length === 1) {
      return { reply: reply.replace(/```[\s\S]*?```/, '').trim() || 'Applying changes...', action: 'apply', code: codeBlocks[0][2].trim(), fileName: activeFile?.name };
    }

    return { reply };
  }

  const selectedModel = model || 'gemini-flash-lite-latest';

  if (genAI && selectedModel.startsWith('gemini')) {
    try {
      const genModel = genAI.getGenerativeModel({ model: selectedModel, systemInstruction: systemPrompt });
      const chat = genModel.startChat({ history });
      const result = await chat.sendMessage(lastUserMessage);
      return res.json(parseReply(result.response.text()));
    } catch (err) { console.error('Gemini API error:', err.message); }
  }

  try {
    const historyText = (messages || []).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const prompt = `${systemPrompt}\n\nCONVERSATION:\n${historyText}\n\nA:`;
    const ollamaModel = selectedModel.startsWith('gemini') ? 'qwen2.5-coder:7b' : selectedModel;
    const response = await axios.post('http://127.0.0.1:11434/api/generate', { model: ollamaModel, prompt, stream: false }, { timeout: 60000 });
    return res.json(parseReply(response.data.response));
  } catch (err) {
    return res.status(500).json({ error: 'No AI backend available.' });
  }
});

// AI auto-debug: takes real stderr + code, returns a fix
app.post('/api/ai/autocomplete', generalLimiter, async (req, res) => {
  const { prefix, suffix, language } = req.body;
  if (!prefix || !language) return res.json({ completion: '' });
  
  const systemPrompt = `You are a strict code autocomplete engine.
You are given a PREFIX and a SUFFIX of a ${language} file. 
You must output ONLY the code that belongs exactly between the PREFIX and SUFFIX.
DO NOT wrap your response in markdown blocks. DO NOT output any explanations.`;

  const prompt = `PREFIX:\n${prefix}\n\nSUFFIX:\n${suffix}`;
  
  try {
    if (genAI) {
      const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest', systemInstruction: systemPrompt });
      const result = await model.generateContent(prompt);
      return res.json({ completion: result.response.text().trim() });
    }
    return res.json({ completion: '' });
  } catch (err) {
    return res.json({ completion: '' });
  }
});

app.post('/api/ai/debug', generalLimiter, validate(codeExecutionSchema), async (req, res) => {
  const { code, language, fileName, error: stderr } = req.body;

  const prompt = `You are a coding agent. The user ran this ${language} code and got a real error from the sandbox. Fix it.

FILE: ${fileName}
CODE:
${code}

REAL ERROR OUTPUT:
${stderr}

If the error is due to a missing package or dependency, you can respond with a MODE 1 scaffold JSON containing a \`package.json\` (or \`requirements.txt\`) with the needed dependencies.
Otherwise, respond with ONLY a single markdown code block containing the COMPLETE fixed file. No explanation before the code block.`;

  if (genAI) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
      const result = await model.generateContent(prompt);
      const reply = result.response.text();
      
      const jsonMatch = reply.match(/\{[\s\S]*"mode"\s*:\s*"scaffold"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return res.json({ scaffold: parsed.items, explanation: 'Scaffolding missing dependencies.' });
        } catch {}
      }
      
      const codeMatch = reply.match(/```(?:\w+)?\n([\s\S]*?)```/);
      if (codeMatch) return res.json({ fixed: codeMatch[1].trim(), explanation: reply.replace(/```[\s\S]*?```/, '').trim() });
      return res.json({ fixed: reply.trim() });
    } catch (err) { console.error('Gemini debug error:', err.message); }
  }

  return res.status(500).json({ error: 'No AI backend available for auto-debug.' });
});

io.on('connection', (socket) => {
  let ptyProcess = null;

  const spawnShell = (preferredShell) => {
    if (ptyProcess) { ptyProcess.kill(); ptyProcess = null; }
    const shellMap = { bash: 'bash', zsh: 'zsh', sh: 'sh' };
    const shell = os.platform() === 'win32'
      ? 'powershell.exe'
      : (shellMap[preferredShell] || 'bash');
    ptyProcess = pty.spawn(shell, [], { name: 'xterm-color', cols: 80, rows: 24, cwd: process.env.HOME, env: process.env });
    ptyProcess.onData((data) => { socket.emit('terminal-output', data); });
    socket.emit('terminal-ready', { shell });
  };

  spawnShell('bash');
  socket.on('terminal-input', (data) => { ptyProcess?.write(data); });
  socket.on('terminal-restart', ({ shell } = {}) => { spawnShell(shell || 'bash'); });
  socket.on('disconnect', () => { ptyProcess?.kill(); });
});

if (require.main === module) {
  server.listen(5000, () => {
    console.log(`🚀 Orbit IDE backend online at http://localhost:5000`);
    console.log(`🤖 AI: ${process.env.GEMINI_API_KEY ? 'Gemini API (primary)' : 'Ollama only'}`);
  });

  // Start y-websocket server for real-time collaboration
  const WebSocket = require('ws');
  const { setupWSConnection } = require('y-websocket/bin/utils');
  const wss = new WebSocket.Server({ port: 5001 });
  wss.on('connection', (conn, req) => {
    setupWSConnection(conn, req, { docName: req.url.slice(1).split('?')[0] || 'default' });
  });
  console.log(`🤝 Real-time Collaboration (y-websocket) online at ws://localhost:5001`);
}

module.exports = { app, server };
