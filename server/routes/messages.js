import { Router } from "express";
import { getClaudeSessionId } from "../../db.js";
import { getSessionMessages as sdkGetSessionMessages } from "@anthropic-ai/claude-agent-sdk";

const router = Router();

/**
 * Convert SDK SessionMessage[] (raw Claude API messages from JSONL) to
 * the Claudeck DB message format the frontend renderer expects:
 *   { id, role, content: JSON.stringify({...}) }
 */
function convertSdkMessages(sdkMessages) {
  const result = [];
  let id = 1;
  for (const msg of sdkMessages) {
    const m = msg.message;
    if (!m?.role) continue;

    const content = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }];

    if (m.role === "user") {
      const textBlocks = content.filter((b) => b.type === "text");
      const toolResults = content.filter((b) => b.type === "tool_result");

      if (textBlocks.length) {
        const text = textBlocks.map((b) => b.text).join("\n");
        result.push({ id: id++, session_id: msg.session_id, role: "user", content: JSON.stringify({ text }), created_at: 0 });
      }
      for (const block of toolResults) {
        const toolContent = Array.isArray(block.content)
          ? block.content.filter((b) => b.type === "text").map((b) => b.text).join("\n")
          : String(block.content ?? "");
        result.push({
          id: id++,
          session_id: msg.session_id,
          role: "tool_result",
          content: JSON.stringify({ toolUseId: block.tool_use_id, content: toolContent, isError: !!block.is_error }),
          created_at: 0,
        });
      }
    } else if (m.role === "assistant") {
      for (const block of content) {
        if (block.type === "thinking") {
          result.push({ id: id++, session_id: msg.session_id, role: "thinking", content: JSON.stringify({ thinking: block.thinking || "", redacted: false }), created_at: 0 });
        } else if (block.type === "redacted_thinking") {
          result.push({ id: id++, session_id: msg.session_id, role: "thinking", content: JSON.stringify({ thinking: "", redacted: true }), created_at: 0 });
        } else if (block.type === "text" && block.text) {
          result.push({ id: id++, session_id: msg.session_id, role: "assistant", content: JSON.stringify({ text: block.text }), created_at: 0 });
        } else if (block.type === "tool_use") {
          result.push({
            id: id++,
            session_id: msg.session_id,
            role: "tool",
            content: JSON.stringify({ id: block.id, name: block.name, input: block.input }),
            created_at: 0,
          });
        }
      }
    }
  }
  return result;
}

// Get all messages for a session — always use SDK
router.get("/:id/messages", async (req, res) => {
  try {
    const sdkMessages = await sdkGetSessionMessages(req.params.id);
    res.json(convertSdkMessages(sdkMessages));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages filtered by chatId — look up the Claude session ID, then fetch from SDK
router.get("/:id/messages/:chatId", async (req, res) => {
  try {
    const claudeSessionId = getClaudeSessionId(req.params.id, req.params.chatId);
    if (!claudeSessionId) return res.json([]);
    const sdkMessages = await sdkGetSessionMessages(claudeSessionId);
    res.json(convertSdkMessages(sdkMessages));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages for single-mode session — always use SDK
router.get("/:id/messages-single", async (req, res) => {
  try {
    const sdkMessages = await sdkGetSessionMessages(req.params.id);
    res.json(convertSdkMessages(sdkMessages));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
