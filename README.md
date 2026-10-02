# Orbit IDE

A cloud IDE in the browser: Monaco editor, real terminals, multi-language code execution in Docker sandboxes, live app previews, git, real-time collaboration, chaos testing, and a Claude-powered AI pair-programmer that can edit your whole project.

**Stack:** React + Vite (frontend, deployable to Vercel) · Express + Socket.IO + Prisma/Postgres (backend) · Docker (terminals and sandboxes) · Claude API (AI).

## What makes Orbit different: AI changes that are proven to work

Most AI coding tools hand you code that *looks* right and leave you to find out it doesn't run. Orbit **proves** every change before you see it:

1. Claude proposes edits.
2. Orbit applies them to a throwaway copy of your project in a sandbox container, so your files are untouched.
3. It runs your **tests** (`npm test`, `pytest`, `node --test`), or runs the program, or at least compiles the changed files.
4. If anything fails, Claude gets the **real error output** and fixes its own code. This repeats up to 3 attempts.
5. You review the diff with a **Verified ✓** badge (for example "npm test: 9 passed") or an honest **Not verified** with the log.

Claude is also told that its work gets tested, so it writes tests alongside non-trivial logic. You can run the same check any time with **Run tests** in the Run & Debug panel, and turn proofs off in Settings.

## Features

- **Real terminal**: each project gets its own Linux container with your files at `/workspace`. Multiple tabs, split view, `npm install`, `pip install`, `git`, dev servers. Files you create in the terminal show up in the explorer automatically. No `node-pty` needed.
- **Run any file** (Ctrl+Enter): JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Rust, Ruby, PHP, Bash, Perl, Lua, R, static HTML. Programs are interactive: type input in the **Run** tab. `package.json` / `requirements.txt` dependencies are installed automatically.
- **Live preview**: servers listening on 3000/4200/5000/5173/8000/8080 open in a preview tab, proxied over HTTPS through the backend.
- **Claude AI assistant**: sees every file in the project, streams answers, and proposes multi-file edits, deletions and runs that you review (with diffs) before anything changes. Editor actions: Ctrl+I to ask about a selection, explain, fix bugs, write tests, add docs. Inline autocomplete.
- **Auto-debug**: when a run fails, Claude reads the real error output and proposes a fix.
- **Source control**: commit, history, per-file diffs (same repo as `git` in the terminal).
- **Collaboration**: open the same file in two browsers and edit together (Yjs).
- **Chaos testing**: run your code under memory limits, CPU throttling, kills and network cuts and get a resilience score.
- **One-click deploy**: keep a project running in a container with a shareable URL.
- **Polished UI** with three themes (Orbit Dark, Midnight, Daylight) that also restyle the editor and terminal. Settings are remembered between visits.
- **Quick Open** (Ctrl+P) for files, a command palette (Ctrl+Shift+P), toggleable sidebar (Ctrl+B), Markdown preview (Ctrl+Shift+V), and line/column in the status bar.
- **Run & Debug panel** listing every runnable file, with AI auto-fix and chaos testing.
- **Project templates**: start from Python, Node + Express, Flask, a static website, C++ or Java.
- **Clone from GitHub**: "Clone Git Repository" on the welcome screen imports any public repo.
- Search/replace across files, command palette (Ctrl+Shift+P), go to line, project download (.tar.gz), chat history.
- The IDE shows a banner if the backend is unreachable, outdated, or missing its database or AI key.

## Local development

**Prerequisites:** Node.js 20+, PostgreSQL, Docker (running).

**Quick start:** after creating `backend/.env` (below), run `./dev.sh` from the repo root. It installs dependencies, updates the database, stops any old backend still running, checks your setup, and starts the backend and frontend together.

**Manual steps:**

```bash
# Backend
cd backend
npm install
cp .env.example .env          # set DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY
npx prisma migrate deploy
npm run doctor                # checks .env, database, Docker and your Claude key
npm run dev                   # http://localhost:5000, restarts automatically when code changes

# Build the terminal image once (node + python + git + build tools).
# Optional: without it terminals fall back to node:20-bookworm-slim.
docker build -t orbit-terminal:latest -f docker/terminal.Dockerfile docker

# Frontend (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Set `VITE_API_URL` in `frontend/.env.local` if the backend isn't at `http://localhost:5000`.

### Terminal modes

`TERMINAL_MODE` in `backend/.env`:

| Mode | What it does |
|---|---|
| `auto` (default) | `docker` if Docker is reachable; otherwise `local` in development and `off` in production |
| `docker` | One container per project, a `docker exec` TTY per tab. Isolated from the host. Use this on servers. |
| `local` | Shell on your own machine in the project's folder (`backend/data/workspaces/<id>`). Uses `node-pty` if it installed (optional dependency), else `script`, else a basic line-mode fallback (works on Windows without build tools). |
| `off` | Disabled |

### AI configuration

Set `ANTHROPIC_API_KEY` in `backend/.env` (`CLAUDE_API_KEY` also works). Restart the backend after changing `.env`. `CLAUDE_MODEL` picks the default chat model (`claude-opus-5-5`; users can switch to Sonnet 5.5 or Haiku 4.5 in the chat panel). Inline autocomplete uses `CLAUDE_FAST_MODEL` (`claude-haiku-4-5`) because it runs on every typing pause.

## Deploying

- **Backend → Oracle Cloud (Always Free):** follow [docs/DEPLOY_ORACLE.md](docs/DEPLOY_ORACLE.md). It's one VM running `docker compose` with Postgres and automatic HTTPS via Caddy.
- **Frontend → Vercel:** set `VITE_API_URL=https://<your-backend-domain>` and redeploy.

The backend needs a Docker host, so it can't run on serverless platforms (Vercel functions, Lambda, etc.).

## Testing

```bash
cd backend && npm test             # Jest + Supertest (uses TEST_DATABASE_URL)
cd frontend && npm run test:e2e    # Playwright (backend and frontend must be running)
```

## Limits

Per IP: auth 20 / 15 min, code execution 40 / min, general API 2000 / 15 min. Per user: AI chat 60 / 15 min, auto-debug 30 / 15 min. Sandboxes get 512 MB RAM, 1 CPU and a 10 minute limit. Terminals get 1 GB RAM (`TERMINAL_MEMORY_MB`) and stop after 20 idle minutes (`TERMINAL_IDLE_MINUTES`); files are kept.

## Security notes

- Every API route, socket and collaboration channel requires a login, and users can only reach their own projects, chats and containers.
- User code runs in containers with memory, CPU and process limits and `no-new-privileges`. Ports are published on `127.0.0.1` only and reached through the authenticated preview proxy.
- In production, run the backend on `127.0.0.1` behind the proxy (the compose file does this) and set `SIGNUP_ENABLED=false` once your account exists.
- Containers share the host kernel. For untrusted public users, add a stronger sandbox runtime such as gVisor (`runsc`).
