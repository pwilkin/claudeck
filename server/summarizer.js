import { query, getSessionMessages as sdkGetSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { updateSessionSummary, getSession } from "../db.js";

export async function generateSessionSummary(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;

  const sdkMessages = await sdkGetSessionMessages(sessionId);
  const conversation = [];
  for (const msg of sdkMessages) {
    const { role, content } = msg.message;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== "text" || !block.text) continue;
      if (role === "user") {
        conversation.push(`User: ${block.text.slice(0, 500)}`);
      } else if (role === "assistant") {
        conversation.push(`Assistant: ${block.text.slice(0, 500)}`);
      }
    }
  }

  if (conversation.length < 2) return null;

  const transcript = conversation.join("\n").slice(-4000);
  const prompt = `Summarize this coding session in 1 short sentence (max 120 chars). Focus on what was accomplished or discussed. No quotes, no prefixes like "Summary:". Just the sentence.\n\n${transcript}`;

  let summary = null;

  const q = query({
    prompt,
    options: {
      maxTurns: 1,
      model: "claude-haiku-4-5-20251001",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  });

  for await (const msg of q) {
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text) {
          summary = block.text.trim().slice(0, 200);
        }
      }
    }
  }

  if (summary) {
    updateSessionSummary(sessionId, summary);
  }
  return summary;
}
