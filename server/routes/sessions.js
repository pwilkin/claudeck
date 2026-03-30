import { Router } from "express";
import { basename } from "path";
import { homedir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";
import {
  listSessions as sdkListSessions,
  getSessionInfo,
  renameSession as sdkRenameSession,
  forkSession as sdkForkSession,
} from "@anthropic-ai/claude-agent-sdk";
import {
  deleteSession as dbDeleteSession,
  toggleSessionPin,
  ensureSession,
  getSessionMetaBatch,
  getSessionBranches,
  getSessionLineage,
} from "../../db.js";
import { getActiveSessionIds } from "../ws-handler.js";
import { generateSessionSummary } from "../summarizer.js";

const router = Router();

// sessionIds map is passed in from the parent
let sessionIds;
export function setSessionIds(map) {
  sessionIds = map;
}

function sdkSessionToRow(s, meta = {}) {
  return {
    id: s.sessionId,
    title: s.customTitle || null,
    summary: s.summary || null,
    project_path: s.cwd || null,
    project_name: s.cwd ? basename(s.cwd) : null,
    last_used_at: s.lastModified ? Math.floor(s.lastModified / 1000) : null,
    pinned: meta.pinned || 0,
    mode: meta.mode || "single",
    parent_session_id: null,
  };
}

// List sessions (filtered by project_path)
router.get("/", async (req, res) => {
  try {
    const projectPath = req.query.project_path || undefined;
    if (!projectPath) return res.json([]);
    const sessions = await sdkListSessions({ dir: projectPath, limit: 50 });
    const metaMap = getSessionMetaBatch(sessions.map((s) => s.sessionId));
    res.json(sessions.map((s) => sdkSessionToRow(s, metaMap.get(s.sessionId))));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search sessions (filter SDK results server-side)
router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").toLowerCase();
    const projectPath = req.query.project_path || undefined;
    if (!projectPath) return res.json([]);
    const sessions = await sdkListSessions({ dir: projectPath, limit: 200 });
    const filtered = q
      ? sessions.filter(
          (s) =>
            (s.summary || "").toLowerCase().includes(q) ||
            (s.customTitle || "").toLowerCase().includes(q) ||
            (s.firstPrompt || "").toLowerCase().includes(q),
        )
      : sessions;
    const metaMap = getSessionMetaBatch(filtered.map((s) => s.sessionId));
    res.json(filtered.slice(0, 20).map((s) => sdkSessionToRow(s, metaMap.get(s.sessionId))));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List session IDs with active (in-flight) queries
router.get("/active", (req, res) => {
  try {
    res.json({ activeSessionIds: getActiveSessionIds() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a session — removes from Claudeck DB and Claude's JSONL storage
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    // Delete from Claudeck DB
    dbDeleteSession(id);
    // Clean up sessionIds map
    for (const [key] of sessionIds) {
      if (key === id || key.startsWith(id + "::")) {
        sessionIds.delete(key);
      }
    }
    // Delete JSONL file from Claude's storage (best effort)
    try {
      const info = await getSessionInfo(id);
      if (info?.cwd) {
        const projectDir = info.cwd.replace(/\//g, "-");
        const jsonlPath = join(homedir(), ".claude", "projects", projectDir, `${id}.jsonl`);
        await unlink(jsonlPath);
      }
    } catch { /* file may not exist */ }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update session title in Claude's storage
router.put("/:id/title", async (req, res) => {
  try {
    const { title } = req.body;
    if (typeof title !== "string") {
      return res.status(400).json({ error: "title is required" });
    }
    await sdkRenameSession(req.params.id, title.slice(0, 200));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle session pin (Claudeck-specific metadata)
router.put("/:id/pin", (req, res) => {
  try {
    ensureSession(req.params.id);
    toggleSessionPin(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate/regenerate summary on demand
router.post("/:id/summary", async (req, res) => {
  try {
    const summary = await generateSessionSummary(req.params.id);
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fork a session via SDK
router.post("/:id/fork", async (req, res) => {
  try {
    const result = await sdkForkSession(req.params.id);
    res.json({ id: result.sessionId, title: null });
  } catch (err) {
    const status = err.message?.includes("not found") ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// List direct child forks (Claudeck-specific branching)
router.get("/:id/branches", (req, res) => {
  try {
    res.json(getSessionBranches(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get full ancestor chain + siblings (Claudeck-specific branching)
router.get("/:id/lineage", (req, res) => {
  try {
    res.json(getSessionLineage(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
