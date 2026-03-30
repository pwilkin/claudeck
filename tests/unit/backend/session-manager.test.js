import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import {
  createOrResumeSession,
  sendToSession,
  abortSession,
  closeSession,
  closeAllSessions,
  hasActiveSession,
  getSessionCwd,
  setSessionModel,
  setSessionPermissionMode,
  closeSessionsForConnection,
  getSessionKeys,
} from "../../../server/session-manager.js";
import { query } from "@anthropic-ai/claude-agent-sdk";

function createMockQuery(onClose) {
  const messages = [];
  const q = (async function* () {
    yield { type: "system", subtype: "init", session_id: "test-claude-sid" };
  })();
  q.close = vi.fn(() => { if (onClose) onClose(); });
  q.setModel = vi.fn(async () => {});
  q.setPermissionMode = vi.fn(async () => {});
  return q;
}

describe("session-manager", () => {
  beforeEach(() => {
    closeAllSessions();
    vi.mocked(query).mockReset();
  });

  describe("createOrResumeSession", () => {
    it("calls query with stream as prompt and merged options", () => {
      const mockQ = createMockQuery();
      vi.mocked(query).mockReturnValue(mockQ);

      const onMessage = vi.fn();
      const session = createOrResumeSession("key-1", { cwd: "/tmp", model: "opus" }, onMessage);

      expect(query).toHaveBeenCalledOnce();
      const callArgs = query.mock.calls[0][0];
      expect(callArgs.prompt).toBeDefined();
      expect(callArgs.options.cwd).toBe("/tmp");
      expect(callArgs.options.model).toBe("opus");
      expect(callArgs.options.abortController).toBeDefined();
      expect(session.query).toBe(mockQ);
    });

    it("aborts existing session if key already exists", () => {
      const mockQ1 = createMockQuery();
      const mockQ2 = createMockQuery();
      vi.mocked(query).mockReturnValue(mockQ1);

      createOrResumeSession("key-dup", { cwd: "/tmp" }, vi.fn());

      vi.mocked(query).mockReturnValue(mockQ2);
      createOrResumeSession("key-dup", { cwd: "/tmp" }, vi.fn());

      expect(mockQ1.close).toHaveBeenCalled();
    });
  });

  describe("sendToSession", () => {
    it("returns ok:true for active session", () => {
      const mockQ = createMockQuery();
      vi.mocked(query).mockReturnValue(mockQ);

      createOrResumeSession("key-send", { cwd: "/tmp" }, vi.fn());
      const result = sendToSession("key-send", "Hello");

      expect(result.ok).toBe(true);
    });

    it("returns ok:false with error:no_session for unknown key", () => {
      const result = sendToSession("nonexistent", "Hello");
      expect(result.ok).toBe(false);
      expect(result.error).toBe("No active session");
    });
  });

  describe("hasActiveSession", () => {
    it("returns false for nonexistent session", () => {
      expect(hasActiveSession("nope")).toBe(false);
    });

    it("returns true for active session", () => {
      const mockQ = createMockQuery();
      vi.mocked(query).mockReturnValue(mockQ);
      createOrResumeSession("key-active", { cwd: "/tmp" }, vi.fn());
      expect(hasActiveSession("key-active")).toBe(true);
    });
  });

  describe("abortSession", () => {
    it("does not throw for nonexistent session", () => {
      expect(() => abortSession("nope")).not.toThrow();
    });
  });

  describe("closeSession", () => {
    it("calls query.close() on the session", () => {
      const mockQ = createMockQuery();
      vi.mocked(query).mockReturnValue(mockQ);
      createOrResumeSession("key-close", { cwd: "/tmp" }, vi.fn());

      closeSession("key-close");
      expect(mockQ.close).toHaveBeenCalled();
    });

    it("does not throw for nonexistent session", () => {
      expect(() => closeSession("nope")).not.toThrow();
    });
  });

  describe("closeAllSessions", () => {
    it("closes all active sessions", () => {
      const mockQ1 = createMockQuery();
      const mockQ2 = createMockQuery();
      vi.mocked(query)
        .mockReturnValueOnce(mockQ1)
        .mockReturnValueOnce(mockQ2);

      createOrResumeSession("key-a", { cwd: "/tmp" }, vi.fn());
      createOrResumeSession("key-b", { cwd: "/tmp" }, vi.fn());

      closeAllSessions();
      expect(mockQ1.close).toHaveBeenCalled();
      expect(mockQ2.close).toHaveBeenCalled();
    });
  });

  describe("closeSessionsForConnection", () => {
    it("closes specified sessions", () => {
      const mockQ1 = createMockQuery();
      const mockQ2 = createMockQuery();
      vi.mocked(query)
        .mockReturnValueOnce(mockQ1)
        .mockReturnValueOnce(mockQ2);

      createOrResumeSession("conn-1", { cwd: "/tmp" }, vi.fn());
      createOrResumeSession("conn-2", { cwd: "/tmp" }, vi.fn());

      closeSessionsForConnection(["conn-1", "conn-2"]);
      expect(mockQ1.close).toHaveBeenCalled();
      expect(mockQ2.close).toHaveBeenCalled();
    });
  });

  describe("getSessionKeys", () => {
    it("returns list of active session keys", () => {
      const mockQ = createMockQuery();
      vi.mocked(query).mockReturnValue(mockQ);

      createOrResumeSession("key-x", { cwd: "/tmp" }, vi.fn());
      createOrResumeSession("key-y", { cwd: "/tmp" }, vi.fn());

      const keys = getSessionKeys();
      expect(keys).toContain("key-x");
      expect(keys).toContain("key-y");
    });
  });
});
