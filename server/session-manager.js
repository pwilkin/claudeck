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

  // Read onMessage dynamically so it can be swapped via updateSessionCallback
  const { query: q, stream } = origSession;
  origSession.consuming = true;
  let error = null;

  try {
    for await (const msg of q) {
      if (stream.isDone) break;
      try {
        const shouldStop = origSession.onMessage(sessionKey, msg);
        if (shouldStop === false) {
          stream.close();
          break;
        }
      } catch { /* ignore callback errors */ }
      if (msg.type === "result" && origSession.resolveFirstResult) {
        origSession.resolveFirstResult();
        origSession.resolveFirstResult = null;
        origSession.rejectFirstResult = null;
      }
    }
  } catch (err) {
    error = err;
    if (err.name !== "AbortError" && !origSession.resolveFirstResult) {
      try { origSession.onMessage(sessionKey, { type: "session_error", error: err.message }); } catch { /* ignore */ }
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
    // Fire completion callback (e.g. for cleanup after detached sessions finish)
    if (origSession.onComplete) {
      try { origSession.onComplete(sessionKey); } catch { /* ignore */ }
    }
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
    wsRef: null,        // mutable WS reference, set by caller via setSessionWsRef
    detached: false,    // true when WS disconnected but session still running
    onComplete: null,   // called when consumeOutput finishes (for detached cleanup)
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

// Forcefully stop a session (user clicked Stop)
export function abortSession(sessionKey) {
  const session = sessions.get(sessionKey);
  if (!session) return;
  session.stream.close();
  try { session.query.close(); } catch { /* ignore */ }
  sessions.delete(sessionKey);
}

// Fully close and destroy a session
export function closeSession(sessionKey) {
  const session = sessions.get(sessionKey);
  if (!session) return;
  session.stream.close();
  try { session.query.close(); } catch { /* ignore */ }
  sessions.delete(sessionKey);
}

// Detach session from its WS — session keeps running, messages are silently dropped
export function detachSession(sessionKey) {
  const session = sessions.get(sessionKey);
  if (!session) return;
  session.detached = true;
  if (session.wsRef) session.wsRef.ws = null;
}

// Detach all sessions for a closing connection (don't kill them)
export function detachSessionsForConnection(sessionKeys) {
  for (const sessionKey of sessionKeys) {
    detachSession(sessionKey);
  }
}

// Update the onMessage callback (for WS re-attachment)
export function updateSessionCallback(sessionKey, newOnMessage) {
  const session = sessions.get(sessionKey);
  if (!session) return false;
  session.onMessage = newOnMessage;
  session.detached = false;
  return true;
}

// Get/set the mutable WS reference stored on a session
export function setSessionWsRef(sessionKey, wsRef) {
  const session = sessions.get(sessionKey);
  if (session) session.wsRef = wsRef;
}

export function getSessionWsRef(sessionKey) {
  const session = sessions.get(sessionKey);
  return session?.wsRef || null;
}

// Get session metadata for inspection
export function getSessionMeta(sessionKey) {
  const session = sessions.get(sessionKey);
  if (!session) return null;
  return {
    detached: session.detached,
    consuming: session.consuming,
    cwd: session.cwd,
    isDone: session.stream.isDone,
  };
}

export function closeAllSessions() {
  for (const sessionKey of [...sessions.keys()]) {
    closeSession(sessionKey);
  }
}

// Keep for backward compat — but prefer detachSessionsForConnection
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
