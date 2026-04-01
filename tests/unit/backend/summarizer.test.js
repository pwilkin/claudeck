import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @anthropic-ai/claude-agent-sdk
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  getSessionMessages: vi.fn(),
}));

// Mock db.js
vi.mock("../../../db.js", () => ({
  getSession: vi.fn(),
  updateSessionSummary: vi.fn(),
}));

import { generateSessionSummary } from "../../../server/summarizer.js";
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { getSession, updateSessionSummary } from "../../../db.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateSessionSummary", () => {
  it("with missing session returns null", async () => {
    getSession.mockReturnValue(null);
    const result = await generateSessionSummary("nonexistent");
    expect(result).toBeNull();
  });

  it("with missing session does not query messages", async () => {
    getSession.mockReturnValue(null);
    await generateSessionSummary("nonexistent");
    expect(getSessionMessages).not.toHaveBeenCalled();
  });

  it("with < 2 parseable messages returns null", async () => {
    getSession.mockReturnValue({ id: "sess-1", title: "Test" });
    getSessionMessages.mockResolvedValue([
      { message: { role: "user", content: [{ type: "text", text: "Hello" }] }, session_id: "sess-1" },
    ]);

    const result = await generateSessionSummary("sess-1");
    expect(result).toBeNull();
  });

  it("with 0 messages returns null", async () => {
    getSession.mockReturnValue({ id: "sess-1", title: "Test" });
    getSessionMessages.mockResolvedValue([]);

    const result = await generateSessionSummary("sess-1");
    expect(result).toBeNull();
  });

  it("with valid conversation calls query and updates DB", async () => {
    getSession.mockReturnValue({ id: "sess-1", title: "Test Session" });
    getSessionMessages.mockResolvedValue([
      { message: { role: "user", content: [{ type: "text", text: "Fix the bug in auth" }] }, session_id: "sess-1" },
      { message: { role: "assistant", content: [{ type: "text", text: "I fixed the authentication bug" }] }, session_id: "sess-1" },
    ]);

    // Mock the async iterator returned by query
    const mockMessages = [
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Fixed authentication bug in login module" }],
        },
      },
    ];
    query.mockReturnValue({
      [Symbol.asyncIterator]: () => {
        let idx = 0;
        return {
          next: () => {
            if (idx < mockMessages.length) {
              return Promise.resolve({ value: mockMessages[idx++], done: false });
            }
            return Promise.resolve({ done: true });
          },
        };
      },
    });

    const result = await generateSessionSummary("sess-1");
    expect(result).toBe("Fixed authentication bug in login module");
    expect(query).toHaveBeenCalledTimes(1);
    expect(updateSessionSummary).toHaveBeenCalledWith("sess-1", "Fixed authentication bug in login module");
  });

  it("summary truncated to 200 chars", async () => {
    getSession.mockReturnValue({ id: "sess-1", title: "Test" });
    getSessionMessages.mockResolvedValue([
      { message: { role: "user", content: [{ type: "text", text: "Do something" }] }, session_id: "sess-1" },
      { message: { role: "assistant", content: [{ type: "text", text: "Done" }] }, session_id: "sess-1" },
    ]);

    const longText = "A".repeat(300);
    query.mockReturnValue({
      [Symbol.asyncIterator]: () => {
        let done = false;
        return {
          next: () => {
            if (!done) {
              done = true;
              return Promise.resolve({
                value: {
                  type: "assistant",
                  message: { content: [{ type: "text", text: longText }] },
                },
                done: false,
              });
            }
            return Promise.resolve({ done: true });
          },
        };
      },
    });

    const result = await generateSessionSummary("sess-1");
    expect(result.length).toBe(200);
  });

  it("SDK returns no text returns null", async () => {
    getSession.mockReturnValue({ id: "sess-1", title: "Test" });
    getSessionMessages.mockResolvedValue([
      { message: { role: "user", content: [{ type: "text", text: "Hello" }] }, session_id: "sess-1" },
      { message: { role: "assistant", content: [{ type: "text", text: "World" }] }, session_id: "sess-1" },
    ]);

    // Return messages with no text blocks
    query.mockReturnValue({
      [Symbol.asyncIterator]: () => {
        let done = false;
        return {
          next: () => {
            if (!done) {
              done = true;
              return Promise.resolve({
                value: { type: "assistant", message: { content: [{ type: "tool_use" }] } },
                done: false,
              });
            }
            return Promise.resolve({ done: true });
          },
        };
      },
    });

    const result = await generateSessionSummary("sess-1");
    expect(result).toBeNull();
    expect(updateSessionSummary).not.toHaveBeenCalled();
  });

  it("messages with unparseable JSON are skipped", async () => {
    getSession.mockReturnValue({ id: "sess-1", title: "Test" });
    getSessionMessages.mockResolvedValue([
      { message: { role: "user", content: [{ type: "tool_use" }] }, session_id: "sess-1" },
      { message: { role: "user", content: [{ type: "text", text: "Valid message" }] }, session_id: "sess-1" },
      { message: { role: "assistant", content: [{ type: "tool_result" }] }, session_id: "sess-1" },
      { message: { role: "assistant", content: [{ type: "text", text: "Valid response" }] }, session_id: "sess-1" },
    ]);

    // 2 messages with text blocks => should proceed
    query.mockReturnValue({
      [Symbol.asyncIterator]: () => {
        let done = false;
        return {
          next: () => {
            if (!done) {
              done = true;
              return Promise.resolve({
                value: {
                  type: "assistant",
                  message: { content: [{ type: "text", text: "Summary of session" }] },
                },
                done: false,
              });
            }
            return Promise.resolve({ done: true });
          },
        };
      },
    });

    const result = await generateSessionSummary("sess-1");
    expect(result).toBe("Summary of session");
  });

  it("does not count messages without text field", async () => {
    getSession.mockReturnValue({ id: "sess-1", title: "Test" });
    getSessionMessages.mockResolvedValue([
      { message: { role: "user", content: [{ type: "image" }] }, session_id: "sess-1" },
      { message: { role: "assistant", content: [{ type: "tool_use" }] }, session_id: "sess-1" },
    ]);

    // Both messages have no text content blocks => conversation.length < 2
    const result = await generateSessionSummary("sess-1");
    expect(result).toBeNull();
  });
});
