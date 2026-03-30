# AGENTS.md

Instructions for agentic coding assistants working in this repository.

## Commands

```bash
# Start dev server
node server.js                    # Port 9009
npx claudeck                      # CLI (port/auth setup)
npx claudeck --port 3000

# Tests
npm test                                          # All tests
npm test -- tests/unit/backend/db.test.js         # Single file
npm test -- tests/unit/frontend/store.test.js     # Single file
npm test -- --watch                                # Watch mode
npm test -- --reporter=verbose                    # Verbose output
npm run test:coverage                             # Coverage report
npm run test:perf                                 # WS benchmarks
```

There is no linter, formatter, or typechecker configured.

## Architecture Summary

- **Backend:** Express 5 + WebSocket (ws) + SQLite (better-sqlite3, WAL mode)
- **Frontend:** Vanilla JS ES modules, Web Components (Light DOM), no build step, no framework
- **Runtime:** Node.js 18+, ESM only
- **Tests:** Vitest + happy-dom (frontend) + supertest (API routes)
- **AI SDK:** `@anthropic-ai/claude-code`, `@anthropic-ai/claude-agent-sdk`

Key entry points: `server.js` (Express + WS), `db.js` (schema + CRUD), `cli.js` (CLI).
Frontend loaded by `main.js` in order: components -> core -> ui -> features -> panels -> plugin-loader.

## Code Style

### Imports

- ESM only (`import`/`export`). Never use `require()`.
- Named imports preferred. Default exports only for Express routers.
- Group loosely: Node builtins/npm packages first, then local files. No blank lines between groups.
- Multi-line named imports stacked vertically:
  ```js
  import {
    createSession,
    updateClaudeSessionId,
    getSession,
  } from "../db.js";
  ```

### Formatting

- **2-space indentation**, no tabs
- **Semicolons** on every statement
- **Double quotes** for strings (single quotes occasionally in frontend constants)
- **No trailing commas** (with occasional exceptions in multi-line arrays/calls)
- **Same-line opening brace** (K&R style)
- **Template literals** for multi-line strings, interpolation, and SQL
- No strict line length limit; SQL and HTML templates may exceed 120 chars
- Arrow functions for callbacks/inline; function declarations for top-level named functions

### Naming

- **Files:** `kebab-case` (e.g., `ws-handler.js`, `cost-dashboard.js`)
- **Variables/functions:** `camelCase`
- **Classes (Web Components):** `PascalCase`, registered with `claudeck-` prefix in kebab-case:
  ```js
  class PromptModal extends HTMLElement { ... }
  customElements.define('claudeck-prompt-modal', PromptModal);
  ```
- **Constants:** `UPPER_SNAKE_CASE` for module-level constants
- No underscore prefix for private functions; simply don't export them

### Module Exports

- Named exports for functions and constants
- Default export only for Express routers:
  ```js
  export default router;
  ```
- Transaction-wrapped DB functions use `export const`:
  ```js
  export const deleteSession = db.transaction((id) => { ... });
  ```

### Types and Documentation

- Pure JavaScript, no TypeScript, no JSDoc type annotations
- JSDoc comments only for complex/non-obvious functions, purely descriptive (no `@param`/`@returns`)
- Section separator comments for major sections:
  ```js
  // ── Middleware ordering ──
  // Helpers
  // ══════════════════════════════════════════════════════════
  ```
- Empty catch blocks annotated: `catch { /* exists */ }` or `catch { /* ignore */ }`

### Error Handling

- Route handlers: `try/catch` with `res.status(500).json({ error: err.message })`
- Validation: early returns with `res.status(400).json({ error: "..." })` or `throw new Error("...")`
- No custom error classes; always plain `Error`
- One-liner try/catch for expected failures:
  ```js
  try { db.exec(`ALTER TABLE ...`); } catch { /* exists */ }
  ```
- Fire-and-forget: `.catch((e) => console.error("...", e.message))`

### Backend Patterns

- Express routes in `server/routes/{name}.js`, each exports a default `Router()`
- Route mounting in `server.js`: `app.use("/api/{name}", {name}Router)`
- WebSocket messages dispatched by `type` field via `switch/case` in `ws-handler.js`
- DB access through prepared statements in a `stmts` object, wrapped by thin export functions
- JSON config read/write helpers with `JSON.stringify(data, null, 2) + "\n"`
- Module-scoped variables for shared state (injected via setter exports like `setSessionIds(map)`)

### Frontend Patterns

- Web Components are thin HTML templates in `connectedCallback`; logic lives in `ui/` or `features/` modules
- Centralized DOM cache in `dom.js`: `export const $ = { el: document.getElementById("el"), ... }`
- State: `store.js` (`getState`/`setState`/`on`), events: `events.js` (`emit`/`on`)
- Event names use colon namespacing: `"ws:message"`, `"ws:connected"`
- Show/hide via `classList.add/remove/toggle("hidden")`
- Imperative DOM creation (`createElement`) for dynamic content; `innerHTML` for template rendering

## Testing

- Test files: `tests/unit/{backend|frontend}/**/*.test.js`, mirroring source structure
- Test environment: `node` default; `happy-dom` auto-applied for `tests/unit/frontend/**` via `environmentMatchGlobs`
- Global setup (`tests/setup.js`) sets `CLAUDECK_HOME` to a temp directory
- Use `vi.mock()` for module-level mocking, `vi.fn()` for function mocks
- Frontend module isolation: `vi.resetModules()` + dynamic `import()` in `beforeEach`
- Route testing: `supertest` with `request(app).get("/...")`
- Mock WebSocket factory pattern:
  ```js
  function createMockWs() {
    const messages = [];
    return { readyState: 1, send: vi.fn((raw) => messages.push(JSON.parse(raw))), messages };
  }
  ```
- Test descriptions: plain English, no BDD prefixes ("should"), e.g.:
  ```js
  it("returns a 64-char hex string", () => { ... });
  ```
- Nested `describe` blocks by function/feature

## Plugin System

Built-in plugins in `plugins/`, user plugins in `~/.claudeck/plugins/`. Each has optional `client.js`, `server.js` (Express router), `client.css`, `config.json`. Server routes auto-mount at `/api/plugins/{name}/`. Client plugins use `tab-sdk.js` to register tabs.

## Key Gotchas

- No build step: all JS is served directly as ESM from `public/`
- `server.js` uses non-top-level `import` statements (after conditional `return`)
- Frontend DOM elements are cached at module load time in `dom.js` — elements must exist in HTML at load time
- DB migrations use `try { ALTER TABLE } catch { /* exists */ }` pattern (no migration framework)
