# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claudeck is a browser-based UI for Claude Code — chat, workflows, autonomous agents, cost tracking, and MCP management from a local web interface. Installable as a PWA. Built with vanilla JS (no framework, no build step) and Express.js.

## Commands

```bash
# Dev
node server.js              # Start server (default port 9009)
npx claudeck                # Start via CLI (handles port/auth setup)
npx claudeck --port 3000    # Custom port

# Tests
npm test                    # Run all tests (vitest)
npm test -- tests/unit/backend/db.test.js              # Single test file
npm test -- --watch                                     # Watch mode
npm run test:coverage                                   # Coverage report
npm run test:perf                                       # WebSocket benchmarks (vitest.config.perf.js)
```

## Architecture

### Stack
- **Runtime:** Node.js 18+ (ESM only, no CommonJS)
- **Backend:** Express 4 + WebSocket (ws)
- **Database:** SQLite via better-sqlite3 (WAL mode)
- **Frontend:** Vanilla JS ES modules, Web Components (Light DOM, no Shadow DOM)
- **AI SDK:** `@anthropic-ai/claude-code` (query API)
- **Tests:** Vitest + happy-dom (frontend) + supertest (API)

### Entry Points
- `cli.js` — CLI entry: port selection, auth token setup
- `server.js` — Express app, middleware, route mounting, WebSocket server
- `db.js` — SQLite schema (10 tables), all exported CRUD functions

### Backend (`server/`)
- `ws-handler.js` — WebSocket message dispatch (largest backend file). Handles chat streaming, tool approval flows, workflow/agent/DAG execution
- `agent-loop.js` — Autonomous agent execution (maxTurns loop with SDK query)
- `orchestrator.js` — Meta-orchestrator: auto-delegates tasks to specialist agents
- `dag-executor.js` — DAG-based parallel agent orchestration with topological sort
- `memory-extractor.js` / `memory-injector.js` / `memory-optimizer.js` — Cross-session memory system
- `auth.js` — Token-based auth with HttpOnly cookies
- `routes/` — 17 Express routers, each mounted at `/api/{name}/*`
- `plugin-mount.js` — Auto-discovers and mounts plugin server routes at `/api/plugins/{name}/`

### Frontend (`public/js/`)

Loaded by `main.js` in order: components → core → ui → features → panels → plugin-loader.

- **`core/`** — Foundation: `store.js` (centralized reactive state via getState/setState/on), `ws.js` (WebSocket + reconnect), `api.js` (REST client), `events.js` (pub/sub), `dom.js` (cached querySelector), `constants.js`
- **`ui/`** — UI interaction: message rendering, slash commands, permissions, model selector, theme, notifications, parallel chat grid, right panel routing
- **`features/`** — Business logic: chat, agents, workflows, sessions, projects, cost dashboard, DAG editor, background sessions, attachments
- **`panels/`** — Right sidebar: file explorer, git panel, memory, MCP manager, skills marketplace, assistant bot
- **`components/`** — 19 Web Components (modals, status bar, overlays) — all use Light DOM

### Database Tables (db.js)
`sessions`, `messages`, `costs`, `claude_sessions`, `push_subscriptions`, `todos`, `agent_context`, `agent_runs`, `memories`, `memories_fts` (FTS5)

### Plugin System
Plugins live in `plugins/{name}/` (built-in) or `~/.claudeck/plugins/{name}/` (user). Each has optional `client.js`, `server.js` (Express router), `client.css`, `config.json`. Server routes auto-mount; client plugins use `tab-sdk.js` to register tabs.

### Multi-Agent Orchestration
Four execution modes, all coordinated through `ws-handler.js`:
1. **Workflows** — Sequential multi-step (each step resumes previous SDK session)
2. **Agents** — Single long-running autonomous query with memory injection
3. **Chains** — Sequential agents with context passing via `agent_context` table
4. **DAGs** — Parallel agent execution with dependency edges (topological sort)

### User Data Directory
`~/.claudeck/` (override with `CLAUDECK_HOME` env var): `.env`, `config/` (JSON configs), `plugins/`, `data.db`

## Code Conventions

- ESM imports only (`import`/`export`, no `require`)
- No build step — all JS served directly
- Frontend state flows through `store.js`; real-time via `ws.js`; REST via `api.js`
- WebSocket message types: `query`, `abort`, `workflow`, `agent`, `chain`, `dag`, `orchestrate`
- CSS uses custom properties for theming (dark/light)
