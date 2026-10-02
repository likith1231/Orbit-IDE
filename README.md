<div align="center">

<img src="docs/images/logo.svg" alt="Orbit IDE logo" width="96" height="96" />

# Orbit IDE

### The cloud IDE whose AI proves its code works before you see it.

Write, run and ship code from any browser: real Linux terminals, 16 languages, live previews, git, real-time collaboration, and a Claude-powered agent that **tests its own changes and fixes them until they pass**.

[![Tests](https://github.com/likith1231/Orbit-IDE/actions/workflows/test.yml/badge.svg)](https://github.com/likith1231/Orbit-IDE/actions/workflows/test.yml)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Node 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)
![Claude](https://img.shields.io/badge/AI-Claude-D97757?logo=anthropic&logoColor=white)
![Docker](https://img.shields.io/badge/Sandbox-Docker-2496ED?logo=docker&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/DB-PostgreSQL-4169E1?logo=postgresql&logoColor=white)

[**Why Orbit**](#-why-orbit) ·
[**Features**](#-features) ·
[**Screenshots**](#-screenshots) ·
[**Quick start**](#-quick-start) ·
[**Deployment**](#%EF%B8%8F-deployment) ·
[**Architecture**](#%EF%B8%8F-architecture)

<br />

<img src="docs/images/hero.png" alt="Orbit IDE editor with the Claude agent, explorer and terminal" width="100%" />

<sub>Editor, file explorer, Claude agent and a real terminal, all in the browser.</sub>

</div>

---

## ✨ Why Orbit

AI coding assistants are fast, but they hand you code that only *looks* right. You paste it in, run it, and find out it's broken. **Orbit closes that loop.** Every change Claude proposes is run in a sandbox first, and if it fails, Claude reads the real error and repairs its own work, before you ever review it.

```mermaid
flowchart LR
    A([You ask]) --> B[Claude proposes edits]
    B --> C[Applied to a scratch copy<br/>in a sandbox container]
    C --> D{Tests · run · compile}
    D -- pass --> E([✅ Verified<br/>you review the diff])
    D -- fail --> F[Real error output<br/>sent back to Claude]
    F --> G[Claude fixes its code]
    G --> C
    D -. 3 failed attempts .-> H([⚠️ Not verified<br/>with the full log])
```

<table>
<tr>
<td width="55%">
<img src="docs/images/proof-live.png" alt="A proof running live in the chat panel" />
</td>
<td>

**Proof, step by step**

- 🧪 Runs your **tests** (`npm test`, `pytest`, `node --test`), or runs the program, or at least **compiles** what changed
- 🔒 Your real files are **never touched** until you accept
- 🔁 On failure Claude gets the **actual error** and retries, up to **3 attempts**
- ✅ You see an honest badge: **Verified** (e.g. *npm test: 9 passed*) or **Not verified** with the log
- 🧠 Claude knows it will be tested, so it **writes tests** for non-trivial logic
- ▶️ Run the same check anytime with **Run tests** in *Run & Debug*

</td>
</tr>
</table>

---

## 🚀 Features

<table>
<tr>
<th width="33%">🤖 AI agent</th>
<th width="33%">🖥️ Real dev environment</th>
<th width="33%">⚡ Workflow</th>
</tr>
<tr valign="top">
<td>

- Sees **every file** in the project
- Streams answers live
- Multi-file **edits, deletes and runs** shown as diffs you accept or reject
- **Proof**: sandbox-verified changes with self-repair
- **Auto-debug** a failed run from its real error
- <kbd>Ctrl</kbd>+<kbd>I</kbd> on a selection: explain, fix, write tests, add docs
- Inline **autocomplete**
- Choose Opus 5.5, Sonnet 5.5 or Haiku 4.5
- Saved chat history per project

</td>
<td>

- A **Linux container per project** with your files at `/workspace`
- Multiple terminal tabs and **split view**
- `npm`, `pip`, `git`, dev servers: it all works
- Files made in the terminal **appear in the explorer**
- **Run any file** with <kbd>Ctrl</kbd>+<kbd>Enter</kbd>, interactive input included
- Dependencies auto-installed from `package.json` / `requirements.txt`
- **Live preview** of servers on 3000, 4200, 5000, 5173, 8000, 8080
- **Chaos testing**: memory limits, CPU throttling, kills, network cuts → resilience score

</td>
<td>

- **Quick Open** <kbd>Ctrl</kbd>+<kbd>P</kbd> and **command palette**
- **Source control**: commit, history, per-file diffs
- **Real-time collaboration** (Yjs)
- **Templates**: Python, Node + Express, Flask, static site, C++, Java
- **Clone** any public GitHub repo
- Search & replace across files
- **One-click deploy** with a shareable URL
- Download the project as `.tar.gz`
- 3 themes: **Orbit Dark, Midnight, Daylight**

</td>
</tr>
</table>

**Runs 16 languages out of the box**

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)
![Java](https://img.shields.io/badge/Java-ED8B00?logo=openjdk&logoColor=white)
![C](https://img.shields.io/badge/C-A8B9CC?logo=c&logoColor=black)
![C++](https://img.shields.io/badge/C%2B%2B-00599C?logo=cplusplus&logoColor=white)
![C#](https://img.shields.io/badge/C%23-512BD4?logo=dotnet&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![Ruby](https://img.shields.io/badge/Ruby-CC342D?logo=ruby&logoColor=white)
![PHP](https://img.shields.io/badge/PHP-777BB4?logo=php&logoColor=white)
![Bash](https://img.shields.io/badge/Bash-4EAA25?logo=gnubash&logoColor=white)
![Perl](https://img.shields.io/badge/Perl-39457E?logo=perl&logoColor=white)
![Lua](https://img.shields.io/badge/Lua-2C2D72?logo=lua&logoColor=white)
![R](https://img.shields.io/badge/R-276DC3?logo=r&logoColor=white)
![HTML/CSS](https://img.shields.io/badge/HTML%2FCSS-E34F26?logo=html5&logoColor=white)

---

## 📸 Screenshots

<table>
<tr>
<td width="50%"><img src="docs/images/welcome.png" alt="Welcome screen" /><p align="center"><b>Welcome</b>: templates, recent projects, clone from GitHub</p></td>
<td width="50%"><img src="docs/images/preview.png" alt="Live preview" /><p align="center"><b>Live preview</b> of a running dev server</p></td>
</tr>
<tr>
<td width="50%"><img src="docs/images/run-tests.png" alt="Run & Debug panel" /><p align="center"><b>Run & Debug</b>: run tests, auto-fix, chaos testing</p></td>
<td width="50%"><img src="docs/images/light.png" alt="Daylight theme" /><p align="center"><b>Daylight</b> theme, editor and terminal included</p></td>
</tr>
<tr>
<td colspan="2"><img src="docs/images/palette.png" alt="Command palette" /><p align="center"><b>Command palette</b>: every action a few keystrokes away</p></td>
</tr>
</table>

---

## ⚡ Quick start

### Prerequisites

| Tool | Version | Why |
|---|---|---|
| [Node.js](https://nodejs.org) | 20+ | Backend and frontend |
| [PostgreSQL](https://www.postgresql.org) | 14+ | Users, projects, files, chats |
| [Docker](https://docs.docker.com/get-docker/) | 24+ | Terminals, code runs and proofs |
| [Claude API key](https://console.anthropic.com) | — | The AI agent |

### 1. Clone and configure

```bash
git clone https://github.com/likith1231/Orbit-IDE.git
cd Orbit-IDE
cp backend/.env.example backend/.env
```

Open `backend/.env` and set at least:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/orbit
JWT_SECRET=<run: openssl rand -hex 64>
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Start everything

```bash
./dev.sh
```

`dev.sh` installs dependencies, applies database migrations, stops any old backend still running, checks your setup, and starts both servers.

| Service | URL |
|---|---|
| 🎨 Frontend | http://localhost:5173 |
| ⚙️ Backend API | http://localhost:5000 |

### 3. (Optional) Build the full terminal image

Gives terminals Node, Python, git and build tools. Without it they fall back to `node:20-bookworm-slim`.

```bash
docker build -t orbit-terminal:latest -f docker/terminal.Dockerfile docker
```

> [!TIP]
> Something not working? Run `cd backend && npm run doctor`. It checks your `.env`, database, migrations, Docker, the terminal image and your Claude key, and tells you exactly how to fix each problem.

<details>
<summary><b>Manual setup (without <code>dev.sh</code>)</b></summary>

```bash
# Backend
cd backend
npm install
npx prisma migrate deploy
npm run doctor
npm run dev                   # http://localhost:5000, restarts on code changes

# Frontend (in a second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Set `VITE_API_URL` in `frontend/.env.local` if the backend isn't at `http://localhost:5000`.

</details>

---

## ⚙️ Configuration

All backend settings live in `backend/.env`. Restart the backend after changing it.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string **(required)** |
| `JWT_SECRET` | dev secret | Signs login tokens. **Set this in production** |
| `ANTHROPIC_API_KEY` | — | Claude API key (`CLAUDE_API_KEY` also works) |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Default chat model (users can switch in the chat panel) |
| `CLAUDE_FAST_MODEL` | `claude-haiku-4-5` | Inline autocomplete model |
| `CORS_ORIGINS` | localhost + Vercel app | Comma-separated allowed frontend origins |
| `SIGNUP_ENABLED` | `true` | Set `false` once your account exists |
| `TERMINAL_MODE` | `auto` | `auto` · `docker` · `local` · `off` (see below) |
| `TERMINAL_IMAGE` | `orbit-terminal:latest` | Image used for project terminals |
| `TERMINAL_MEMORY_MB` | `1024` | Memory per terminal container |
| `TERMINAL_IDLE_MINUTES` | `20` | Stop idle terminal containers after this long (files are kept) |
| `HOST` / `PORT` | — / `5000` | Where the backend listens |
| `DOCKER_IMAGE_MIRROR` | — | Registry mirror for pulling sandbox images |

Frontend: `VITE_API_URL` points the UI at the backend (default `http://localhost:5000`).

<details>
<summary><b>Terminal modes</b></summary>

| Mode | What it does |
|---|---|
| `auto` | `docker` if Docker is reachable; otherwise `local` in development and `off` in production |
| `docker` | One container per project and a `docker exec` TTY per tab. Isolated from the host. **Use this on servers.** |
| `local` | A shell on your own machine in `backend/data/workspaces/<id>`. Uses `node-pty` if installed, else `script`, else a basic line mode (works on Windows without build tools). |
| `off` | Disabled |

</details>

---

## ☁️ Deployment

```mermaid
flowchart LR
    U((Browser)) -->|HTTPS| V[Vercel<br/>React frontend]
    U -->|HTTPS · WebSocket| C
    subgraph VM[Oracle Cloud VM · Always Free]
        C[Caddy<br/>auto HTTPS] --> B[Orbit backend<br/>Express · Socket.IO]
        B --> P[(PostgreSQL)]
        B --> D[[Docker<br/>terminals · runs · proofs]]
    end
```

| Part | Where | How |
|---|---|---|
| Frontend | **Vercel** | Set `VITE_API_URL=https://<your-backend-domain>` and redeploy |
| Backend | **Oracle Cloud** (Ampere A1, Always Free) | One VM running `docker compose`: Postgres, backend and Caddy |

On the server:

```bash
git clone https://github.com/likith1231/Orbit-IDE.git && cd Orbit-IDE
sudo bash deploy/setup-oracle.sh     # Docker, firewall, metadata protection
cp deploy/.env.example .env          # fill in domain, secrets, Claude key
docker compose up -d --build
```

The full walkthrough is in **[docs/DEPLOY_ORACLE.md](docs/DEPLOY_ORACLE.md)**.

> [!NOTE]
> The backend needs a Docker host, so it can't run on serverless platforms (Vercel functions, Lambda). No domain? Use a free `sslip.io` name such as `api.<your-ip>.sslip.io` and Caddy will still get a real HTTPS certificate.

---

## 🏗️ Architecture

```mermaid
flowchart TB
    subgraph FE[Frontend · React 19 + Vite]
        M[Monaco editor] --- X[xterm.js terminals]
        X --- AI[Agent chat + Proof UI]
    end
    subgraph BE[Backend · Node 20 + Express 5]
        R[REST API + SSE] --- S[Socket.IO terminals]
        S --- Y[Yjs collaboration]
        R --- PV[Preview proxy]
        R --- VF[Proof engine]
    end
    FE <-->|HTTP · SSE · WebSocket| BE
    BE --> DB[(PostgreSQL · Prisma)]
    BE --> DK[[Docker containers]]
    BE --> CL{{Claude API}}
```

| Layer | Technology |
|---|---|
| Editor | Monaco 0.55, xterm.js 6, react-resizable-panels |
| Frontend | React 19, Vite, TypeScript |
| API | Express 5, Socket.IO 4, Zod validation, JWT auth, rate limiting |
| Data | PostgreSQL, Prisma 6 |
| Sandboxing | Docker via dockerode (terminals, runs, proofs, chaos tests) |
| Collaboration | Yjs + y-websocket |
| AI | Anthropic SDK: streaming, tool use, prompt caching |

<details>
<summary><b>Project structure</b></summary>

```text
Orbit-IDE/
├── backend/
│   ├── lib/
│   │   ├── ai.js          # Claude agent, tools, proof loop
│   │   ├── verify.js      # Proof engine: plan → sandbox run → result
│   │   ├── terminal.js    # Docker / local terminals
│   │   ├── workspace.js   # DB ⇄ disk file sync
│   │   ├── preview.js     # Signed live-preview proxy
│   │   └── templates.js   # Project templates
│   ├── routes/            # ai, auth, chats, chaos, git, projects, run
│   ├── prisma/            # Schema and migrations
│   ├── scripts/doctor.js  # npm run doctor
│   └── tests/             # Jest + Supertest
├── frontend/
│   └── src/
│       ├── IDE.tsx        # The IDE
│       ├── ide.css        # Design system and themes
│       └── components/    # TerminalPanel, backgrounds, navbar
├── docker/terminal.Dockerfile
├── deploy/                # Caddyfile, Oracle setup script, env example
├── docker-compose.yml
├── dev.sh                 # One-command local start
└── docs/                  # Deployment and chaos engineering guides
```

</details>

---

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Run the current file |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | Quick Open a file |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | Command palette |
| <kbd>Ctrl</kbd>+<kbd>I</kbd> | Ask Claude about the selection |
| <kbd>Ctrl</kbd>+<kbd>B</kbd> | Toggle the sidebar |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Save |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> | Markdown preview |

<sub>Use <kbd>⌘</kbd> instead of <kbd>Ctrl</kbd> on macOS.</sub>

---

## 🧪 Testing

```bash
cd backend && npm test             # Jest + Supertest: auth, security, proof engine
cd frontend && npm run test:e2e    # Playwright end-to-end (backend and frontend running)
```

Backend tests run on every push and pull request via GitHub Actions.

---

## 🔐 Security

- 🔑 Every API route, socket and collaboration channel requires login; users only reach their **own** projects, chats and containers.
- 📦 User code runs in containers with memory, CPU and process limits and `no-new-privileges`.
- 🌐 Container ports bind to `127.0.0.1` only and are reached through the **signed, authenticated** preview proxy.
- 🛡️ In production the backend listens on `127.0.0.1` behind Caddy, and the cloud metadata endpoint is blocked from containers.
- 🚪 Set `SIGNUP_ENABLED=false` after creating your account.

> [!WARNING]
> Containers share the host kernel. If you open Orbit to untrusted public users, add a stronger sandbox runtime such as [gVisor](https://gvisor.dev) (`runsc`).

---

## 📏 Limits

| Resource | Limit |
|---|---|
| Code runs | 512 MB RAM · 1 CPU · 10 min |
| Terminals | 1 GB RAM · stop after 20 idle minutes (files kept) |
| Proofs | 768 MB RAM · tests up to 3 min · 3 repair attempts |
| AI (per user) | Chat 60 / 15 min · auto-debug 30 / 15 min |
| API (per IP) | Auth 20 / 15 min · runs 40 / min · general 2000 / 15 min |

---

## 🛟 Troubleshooting

<details>
<summary><b>The terminal is blank or I can't type</b></summary>

An old backend is probably still running on port 5000. `npm start` / `npm run dev` stop it automatically; you can also run `cd backend && npm run stop`. Then refresh the page.

</details>

<details>
<summary><b><code>python3: not found</code> in the terminal</b></summary>

The terminal is using the slim fallback image. Build the full one:

```bash
docker build -t orbit-terminal:latest -f docker/terminal.Dockerfile docker
```

Then open a new terminal tab.

</details>

<details>
<summary><b>A proof says "Untested"</b></summary>

Either Docker isn't reachable from the backend, or the change has nothing checkable (no tests, no runnable file, no code that compiles). `npm run doctor` shows the Docker status.

</details>

<details>
<summary><b>Docker Hub rate limit when pulling images</b></summary>

Log in with `docker login`, or set `DOCKER_IMAGE_MIRROR=mirror.gcr.io` in your `.env`.

</details>

---

## 🗺️ Roadmap

- [x] Real per-project Linux terminals
- [x] Claude agent with multi-file edits
- [x] **Proof**: sandbox-verified AI changes with self-repair
- [x] Themes, command palette, templates, GitHub clone
- [ ] Step-through debugger
- [ ] Shareable read-only project links
- [ ] Open pull requests from Source Control

---

<div align="center">

Built with ❤️ by **Likith** · AI by **Claude**

<sub>If Orbit helped you, consider giving it a ⭐</sub>

</div>
