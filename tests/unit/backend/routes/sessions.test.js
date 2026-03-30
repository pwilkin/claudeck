import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSdkListSessions = vi.fn(async () => []);
const mockSdkGetSessionInfo = vi.fn(async () => undefined);
const mockSdkRenameSession = vi.fn(async () => undefined);
const mockSdkForkSession = vi.fn(async () => ({ sessionId: "fork-new" }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  listSessions: (...args) => mockSdkListSessions(...args),
  getSessionInfo: (...args) => mockSdkGetSessionInfo(...args),
  renameSession: (...args) => mockSdkRenameSession(...args),
  forkSession: (...args) => mockSdkForkSession(...args),
  query: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  unlink: vi.fn(async () => undefined),
}));

vi.mock("../../../../db.js", () => ({
  deleteSession: vi.fn(),
  toggleSessionPin: vi.fn(),
  ensureSession: vi.fn(),
  getSessionMetaBatch: vi.fn(() => new Map()),
  getSessionBranches: vi.fn(() => []),
  getSessionLineage: vi.fn(() => ({ ancestors: [], siblings: [] })),
}));

vi.mock("../../../../server/ws-handler.js", () => ({
  getActiveSessionIds: vi.fn(() => []),
}));

vi.mock("../../../../server/summarizer.js", () => ({
  generateSessionSummary: vi.fn(async () => "Test summary"),
}));

import sessionsRouter, { setSessionIds } from "../../../../server/routes/sessions.js";
import {
  deleteSession as dbDeleteSession,
  toggleSessionPin,
  ensureSession,
  getSessionMetaBatch,
  getSessionBranches,
  getSessionLineage,
} from "../../../../db.js";
import { getActiveSessionIds } from "../../../../server/ws-handler.js";
import { generateSessionSummary } from "../../../../server/summarizer.js";

// ── App setup ────────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/sessions", sessionsRouter);
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("sessions routes", () => {
  let app;
  let sessionIds;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    sessionIds = new Map();
    setSessionIds(sessionIds);
    mockSdkListSessions.mockResolvedValue([]);
    mockSdkGetSessionInfo.mockResolvedValue(undefined);
    mockSdkRenameSession.mockResolvedValue(undefined);
    mockSdkForkSession.mockResolvedValue({ sessionId: "fork-new" });
    getSessionMetaBatch.mockReturnValue(new Map());
  });

  // ── GET / ──────────────────────────────────────────────────────────────
  describe("GET /sessions", () => {
    it("returns empty array when no project_path", async () => {
      const res = await request(app).get("/sessions");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(mockSdkListSessions).not.toHaveBeenCalled();
    });

    it("returns mapped session list from SDK", async () => {
      mockSdkListSessions.mockResolvedValue([
        {
          sessionId: "s1",
          customTitle: "My Session",
          summary: "A summary",
          cwd: "/my/project",
          lastModified: 1700000000000,
        },
      ]);

      const res = await request(app).get("/sessions?project_path=/my/project");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        id: "s1",
        title: "My Session",
        summary: "A summary",
        project_path: "/my/project",
        project_name: "project",
        last_used_at: 1700000000,
        pinned: 0,
        mode: "single",
        parent_session_id: null,
      });
      expect(mockSdkListSessions).toHaveBeenCalledWith({ dir: "/my/project", limit: 50 });
    });

    it("augments sessions with DB metadata (pinned, mode)", async () => {
      mockSdkListSessions.mockResolvedValue([{ sessionId: "s1", cwd: "/p", lastModified: 0 }]);
      getSessionMetaBatch.mockReturnValue(new Map([["s1", { pinned: 1, mode: "parallel" }]]));

      const res = await request(app).get("/sessions?project_path=/p");

      expect(res.body[0]).toMatchObject({ id: "s1", pinned: 1, mode: "parallel" });
    });

    it("returns 500 on SDK error", async () => {
      mockSdkListSessions.mockRejectedValue(new Error("SDK failure"));

      const res = await request(app).get("/sessions?project_path=/p");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("SDK failure");
    });
  });

  // ── GET /search ────────────────────────────────────────────────────────
  describe("GET /sessions/search", () => {
    it("returns empty array when no project_path", async () => {
      const res = await request(app).get("/sessions/search?q=test");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("filters sessions by summary, customTitle, firstPrompt", async () => {
      mockSdkListSessions.mockResolvedValue([
        { sessionId: "s1", summary: "talks about testing", cwd: "/p", lastModified: 0 },
        { sessionId: "s2", customTitle: "My test session", cwd: "/p", lastModified: 0 },
        { sessionId: "s3", firstPrompt: "test this code", cwd: "/p", lastModified: 0 },
        { sessionId: "s4", summary: "unrelated topic", cwd: "/p", lastModified: 0 },
      ]);

      const res = await request(app).get("/sessions/search?q=test&project_path=/p");

      expect(res.status).toBe(200);
      expect(res.body.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    });

    it("returns all sessions when query is empty", async () => {
      mockSdkListSessions.mockResolvedValue([
        { sessionId: "s1", cwd: "/p", lastModified: 0 },
        { sessionId: "s2", cwd: "/p", lastModified: 0 },
      ]);

      const res = await request(app).get("/sessions/search?project_path=/p");

      expect(res.body).toHaveLength(2);
      expect(mockSdkListSessions).toHaveBeenCalledWith({ dir: "/p", limit: 200 });
    });

    it("returns 500 on error", async () => {
      mockSdkListSessions.mockRejectedValue(new Error("Search failed"));

      const res = await request(app).get("/sessions/search?q=test&project_path=/p");
      expect(res.status).toBe(500);
    });
  });

  // ── DELETE /:id ────────────────────────────────────────────────────────
  describe("DELETE /sessions/:id", () => {
    it("deletes a session and returns ok", async () => {
      const res = await request(app).delete("/sessions/abc-123");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(dbDeleteSession).toHaveBeenCalledWith("abc-123");
    });

    it("cleans up sessionIds map entries for the deleted session", async () => {
      sessionIds.set("abc-123", "claude-sid");
      sessionIds.set("abc-123::chat-1", "claude-sid-2");
      sessionIds.set("other-id", "claude-sid-3");

      await request(app).delete("/sessions/abc-123");

      expect(sessionIds.has("abc-123")).toBe(false);
      expect(sessionIds.has("abc-123::chat-1")).toBe(false);
      expect(sessionIds.has("other-id")).toBe(true);
    });

    it("returns 500 when deletion fails", async () => {
      dbDeleteSession.mockImplementation(() => {
        throw new Error("Delete error");
      });

      const res = await request(app).delete("/sessions/bad-id");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Delete error");
    });
  });

  // ── PUT /:id/title ────────────────────────────────────────────────────
  describe("PUT /sessions/:id/title", () => {
    it("renames session via SDK", async () => {
      const res = await request(app)
        .put("/sessions/s1/title")
        .send({ title: "New Title" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockSdkRenameSession).toHaveBeenCalledWith("s1", "New Title");
    });

    it("truncates title to 200 characters", async () => {
      const longTitle = "x".repeat(300);
      await request(app).put("/sessions/s1/title").send({ title: longTitle });

      expect(mockSdkRenameSession).toHaveBeenCalledWith("s1", "x".repeat(200));
    });

    it("returns 400 when title is not a string", async () => {
      const res = await request(app)
        .put("/sessions/s1/title")
        .send({ title: 123 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("title is required");
      expect(mockSdkRenameSession).not.toHaveBeenCalled();
    });

    it("returns 400 when title is missing", async () => {
      const res = await request(app).put("/sessions/s1/title").send({});
      expect(res.status).toBe(400);
    });

    it("returns 500 when SDK rename throws", async () => {
      mockSdkRenameSession.mockRejectedValue(new Error("Rename failed"));

      const res = await request(app)
        .put("/sessions/s1/title")
        .send({ title: "Valid" });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Rename failed");
    });
  });

  // ── PUT /:id/pin ──────────────────────────────────────────────────────
  describe("PUT /sessions/:id/pin", () => {
    it("ensures session row exists then toggles pin", async () => {
      const res = await request(app).put("/sessions/s1/pin");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(ensureSession).toHaveBeenCalledWith("s1");
      expect(toggleSessionPin).toHaveBeenCalledWith("s1");
    });

    it("returns 500 on error", async () => {
      toggleSessionPin.mockImplementation(() => {
        throw new Error("Pin error");
      });

      const res = await request(app).put("/sessions/s1/pin");
      expect(res.status).toBe(500);
    });
  });

  // ── GET /active ────────────────────────────────────────────────────────
  describe("GET /sessions/active", () => {
    it("returns active session IDs", async () => {
      getActiveSessionIds.mockReturnValue(["s1", "s2"]);

      const res = await request(app).get("/sessions/active");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ activeSessionIds: ["s1", "s2"] });
    });

    it("returns 500 on error", async () => {
      getActiveSessionIds.mockImplementation(() => {
        throw new Error("Active error");
      });

      const res = await request(app).get("/sessions/active");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Active error");
    });
  });

  // ── POST /:id/summary ─────────────────────────────────────────────────
  describe("POST /sessions/:id/summary", () => {
    it("generates a session summary", async () => {
      generateSessionSummary.mockResolvedValue("Great session");

      const res = await request(app).post("/sessions/s1/summary");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, summary: "Great session" });
      expect(generateSessionSummary).toHaveBeenCalledWith("s1");
    });

    it("returns 500 when summarizer fails", async () => {
      generateSessionSummary.mockRejectedValue(new Error("Summary error"));

      const res = await request(app).post("/sessions/s1/summary");
      expect(res.status).toBe(500);
    });
  });

  // ── POST /:id/fork ──────────────────────────────────────────────────
  describe("POST /sessions/:id/fork", () => {
    it("forks a session via SDK and returns new session id", async () => {
      mockSdkForkSession.mockResolvedValue({ sessionId: "fork-new-1" });

      const res = await request(app).post("/sessions/s1/fork");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: "fork-new-1", title: null });
      expect(mockSdkForkSession).toHaveBeenCalledWith("s1");
    });

    it("returns 400 on not-found error from SDK", async () => {
      mockSdkForkSession.mockRejectedValue(new Error("session not found"));

      const res = await request(app).post("/sessions/nonexistent/fork");

      expect(res.status).toBe(400);
    });

    it("returns 500 on unexpected SDK error", async () => {
      mockSdkForkSession.mockRejectedValue(new Error("Unexpected error"));

      const res = await request(app).post("/sessions/s1/fork");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Unexpected error");
    });
  });

  // ── GET /:id/branches ────────────────────────────────────────────────
  describe("GET /sessions/:id/branches", () => {
    it("returns branches for a session", async () => {
      const branches = [
        { id: "fork-1", title: "Fork of: Test", parent_session_id: "s1" },
        { id: "fork-2", title: "Fork of: Test", parent_session_id: "s1" },
      ];
      getSessionBranches.mockReturnValue(branches);

      const res = await request(app).get("/sessions/s1/branches");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(branches);
      expect(getSessionBranches).toHaveBeenCalledWith("s1");
    });

    it("returns empty array when no branches exist", async () => {
      getSessionBranches.mockReturnValue([]);

      const res = await request(app).get("/sessions/s1/branches");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 500 on error", async () => {
      getSessionBranches.mockImplementation(() => {
        throw new Error("DB failure");
      });

      const res = await request(app).get("/sessions/s1/branches");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("DB failure");
    });
  });

  // ── GET /:id/lineage ─────────────────────────────────────────────────
  describe("GET /sessions/:id/lineage", () => {
    it("returns ancestors and siblings", async () => {
      const lineage = {
        ancestors: [{ id: "root", title: "Root" }],
        siblings: [{ id: "sibling-1", title: "Fork of: Root" }],
      };
      getSessionLineage.mockReturnValue(lineage);

      const res = await request(app).get("/sessions/fork-1/lineage");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(lineage);
      expect(getSessionLineage).toHaveBeenCalledWith("fork-1");
    });

    it("returns empty arrays for root session", async () => {
      getSessionLineage.mockReturnValue({ ancestors: [], siblings: [] });

      const res = await request(app).get("/sessions/s1/lineage");

      expect(res.status).toBe(200);
      expect(res.body.ancestors).toEqual([]);
      expect(res.body.siblings).toEqual([]);
    });

    it("returns 500 on error", async () => {
      getSessionLineage.mockImplementation(() => {
        throw new Error("Lineage error");
      });

      const res = await request(app).get("/sessions/fork-1/lineage");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Lineage error");
    });
  });
});
