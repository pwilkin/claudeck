import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../../db.js", () => ({
  getClaudeSessionId: vi.fn(() => null),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: vi.fn(() => Promise.resolve([])),
}));

const messagesRouter = (await import("../../../../server/routes/messages.js")).default;
import { getClaudeSessionId } from "../../../../db.js";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

// ── App setup ────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/sessions", messagesRouter);
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("messages routes", () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  // ── GET /:id/messages ───────────────────────────────────────────────────

  describe("GET /sessions/:id/messages", () => {
    it("returns messages for a session", async () => {
      const sdkMessages = [
        { message: { role: "user", content: [{ type: "text", text: "Hello" }] }, session_id: "s1" },
        { message: { role: "assistant", content: [{ type: "text", text: "Hi there" }] }, session_id: "s1" },
      ];
      getSessionMessages.mockResolvedValue(sdkMessages);

      const res = await request(app).get("/sessions/s1/messages");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: 1, session_id: "s1", role: "user", content: JSON.stringify({ text: "Hello" }), created_at: 0 },
        { id: 2, session_id: "s1", role: "assistant", content: JSON.stringify({ text: "Hi there" }), created_at: 0 },
      ]);
      expect(getSessionMessages).toHaveBeenCalledWith("s1");
    });

    it("returns empty array when session has no messages", async () => {
      getSessionMessages.mockResolvedValue([]);

      const res = await request(app).get("/sessions/empty-session/messages");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 500 on SDK error", async () => {
      getSessionMessages.mockRejectedValue(new Error("SDK read error"));

      const res = await request(app).get("/sessions/s1/messages");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("SDK read error");
    });
  });

  // ── GET /:id/messages/:chatId ───────────────────────────────────────────

  describe("GET /sessions/:id/messages/:chatId", () => {
    it("returns messages filtered by chatId", async () => {
      const sdkMessages = [
        { message: { role: "user", content: [{ type: "text", text: "In chat" }] }, session_id: "claude-s1" },
      ];
      getClaudeSessionId.mockReturnValue("claude-s1");
      getSessionMessages.mockResolvedValue(sdkMessages);

      const res = await request(app).get("/sessions/s1/messages/chat-1");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: 1, session_id: "claude-s1", role: "user", content: JSON.stringify({ text: "In chat" }), created_at: 0 },
      ]);
      expect(getClaudeSessionId).toHaveBeenCalledWith("s1", "chat-1");
      expect(getSessionMessages).toHaveBeenCalledWith("claude-s1");
    });

    it("returns empty array when chatId has no Claude session", async () => {
      getClaudeSessionId.mockReturnValue(null);

      const res = await request(app).get("/sessions/s1/messages/no-messages");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(getSessionMessages).not.toHaveBeenCalled();
    });

    it("returns 500 on SDK error", async () => {
      getClaudeSessionId.mockReturnValue("claude-s1");
      getSessionMessages.mockRejectedValue(new Error("SDK failure"));

      const res = await request(app).get("/sessions/s1/messages/chat-1");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("SDK failure");
    });
  });

  // ── GET /:id/messages-single ────────────────────────────────────────────

  describe("GET /sessions/:id/messages-single", () => {
    it("returns single-mode messages via SDK", async () => {
      const sdkMessages = [
        { message: { role: "user", content: [{ type: "text", text: "Single mode" }] }, session_id: "s1" },
      ];
      getSessionMessages.mockResolvedValue(sdkMessages);

      const res = await request(app).get("/sessions/s1/messages-single");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: 1, session_id: "s1", role: "user", content: JSON.stringify({ text: "Single mode" }), created_at: 0 },
      ]);
      expect(getSessionMessages).toHaveBeenCalledWith("s1");
    });

    it("returns empty array when no single-mode messages exist", async () => {
      getSessionMessages.mockResolvedValue([]);

      const res = await request(app).get("/sessions/s1/messages-single");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 500 on SDK error", async () => {
      getSessionMessages.mockRejectedValue(new Error("Single mode error"));

      const res = await request(app).get("/sessions/s1/messages-single");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Single mode error");
    });
  });
});
