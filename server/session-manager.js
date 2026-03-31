import { MessageStream } from "./message-stream.js";
import { query } from "@anthropic-ai/claude-agent-sdk";

const sessions = new Map();

function buildSdkUserMessage(text, images, claudeSessionId) {
  const content = [];
  content.push({ type: "text", text });
  if (images?.length) {
    for (const img of images) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.mimeType, data: img.data },
      });
    }
  }
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: claudeSessionId || "",
  };
}

async function consumeOutput(sessionKey) {
  const origSession = sessions.get(sessionKey);
  if (!origSession) return;

  const { query: q, onMessage, stream } = origSession;
  origSession.consuming = true;
  let error = null;

  try {
    for await (const msg of q) {
      if (stream.isDone) break;
      try {
        const shouldStop = onMessage(sessionKey, msg);
        if (shouldStop === false) {
          stream.close();
          break;
        }
      } catch { /* exists */ }
      if (msg.type === "result" && origSession.resolveFirstResult) {
        origSession.resolveFirstResult();
        origSession.resolveFirstResult = null;
        origSession.rejectFirstResult = null;
      }
    }
  } catch (err) {
    error = err;
    if (err.name !== "AbortError" && !origSession.resolveFirstResult) {
      try { onMessage(sessionKey, { type: "session_error", error: err.message }); } catch { /* exists */ }
    }
  }

  if (origSession.resolveFirstResult) {
    if (error) {
      origSession.rejectFirstResult(error);
    } else {
      origSession.resolveFirstResult();
    }
    origSession.resolveFirstResult = null;
    origSession.rejectFirstResult = null;
  }

  if (sessions.get(sessionKey) === origSession) {
    origSession.consuming = false;
    sessions.delete(sessionKey);
  }
}

export function createOrResumeSession(sessionKey, options, onMessage) {
  if (sessions.has(sessionKey)) {
    closeSession(sessionKey);
  }

  const stream = new MessageStream();
  const abortController = new AbortController();

  const q = query({
    prompt: stream,
    options: { ...options, abortController, includePartialMessages: true },
  });

  let resolveFirstResult;
  let rejectFirstResult;
  const firstResultPromise = new Promise((resolve, reject) => {
    resolveFirstResult = resolve;
    rejectFirstResult = reject;
  });

  const session = {
    query: q,
    stream,
    abortController,
    options,
    cwd: options.cwd || null,
    consuming: false,
    onMessage,
    firstResultPromise,
    resolveFirstResult,
    rejectFirstResult,
  };
  sessions.set(sessionKey, session);

  consumeOutput(sessionKey).catch((err) => {
    console.error(`Session consume error [${sessionKey}]:`, err.message);
  });

  return session;
}

export function sendToSession(sessionKey, message, images, claudeSessionId) {
  const session = sessions.get(sessionKey);
  if (!session) return { ok: false, error: "No active session" };

  const sdkMsg = buildSdkUserMessage(message, images, claudeSessionId);
  session.stream.push(sdkMsg);
  return { ok: true };
}

export function abortSession(sessionKey) {
  const session = sessions.get(sessionKey);
  if (!session) return;
  session.stream.close();
  try { session.query.close(); } catch { /* ignore */ }
  sessions.delete(sessionKey);
}

export function closeSession(sessionKey) {
  const session = sessions.get(sessionKey);
  if (!session) return;
  session.stream.close();
  try { session.query.close(); } catch { /* exists */ }
  sessions.delete(sessionKey);
}

export function closeAllSessions() {
  for (const sessionKey of [...sessions.keys()]) {
    closeSession(sessionKey);
  }
}

export function closeSessionsForConnection(sessionKeys) {
  for (const sessionKey of sessionKeys) {
    closeSession(sessionKey);
  }
}

export function hasActiveSession(sessionKey) {
  const session = sessions.get(sessionKey);
  return !!session && !session.stream.isDone;
}

export function getSessionCwd(sessionKey) {
  const session = sessions.get(sessionKey);
  return session?.cwd || null;
}

export function setSessionModel(sessionKey, model) {
  const session = sessions.get(sessionKey);
  if (session?.query?.setModel) {
    session.query.setModel(model).catch(() => {});
  }
}

export function setSessionPermissionMode(sessionKey, mode) {
  const session = sessions.get(sessionKey);
  if (session?.query?.setPermissionMode) {
    session.query.setPermissionMode(mode).catch(() => {});
  }
}

export function getSessionKeys() {
  return [...sessions.keys()];
}
