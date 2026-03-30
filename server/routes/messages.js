import { Router } from "express";
import { getMessages, getMessagesByChatId, getMessagesNoChatId } from "../../db.js";
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

// Get all messages for a session — fall back to SDK if not in Claudeck DB
router.get("/:id/messages", async (req, res) => {
  try {
    const messages = getMessages(req.params.id);
    if (messages.length > 0) return res.json(messages);
    const sdkMessages = await sdkGetSessionMessages(req.params.id);
    res.json(convertSdkMessages(sdkMessages));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages filtered by chatId
router.get("/:id/messages/:chatId", (req, res) => {
  try {
    const messages = getMessagesByChatId(req.params.id, req.params.chatId);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages where chat_id IS NULL (single-mode) — fall back to SDK
router.get("/:id/messages-single", async (req, res) => {
  try {
    const messages = getMessagesNoChatId(req.params.id);
    if (messages.length > 0) return res.json(messages);
    const sdkMessages = await sdkGetSessionMessages(req.params.id);
    res.json(convertSdkMessages(sdkMessages));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
