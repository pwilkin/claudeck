// Context Window Indicator — real context usage from SDK (status bar)
import { getState, setState } from '../core/store.js';
import { $ } from '../core/dom.js';

const sbGaugeSep = document.getElementById("sb-gauge-sep");

const DEFAULT_CONTEXT_WINDOW = 200_000;

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function renderGauge(tokens) {
  if (!$.contextGauge) return;

  const limit = tokens.contextWindow || DEFAULT_CONTEXT_WINDOW;
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
  const pct = Math.min((total / limit) * 100, 100);

  $.contextGauge.classList.remove('hidden');
  if (sbGaugeSep) sbGaugeSep.classList.remove('hidden');

  $.contextGaugeFill.style.width = pct + '%';

  $.contextGaugeFill.classList.remove('warning', 'critical');
  $.contextGauge.classList.remove('warning', 'critical');
  if (pct >= 80) {
    $.contextGaugeFill.classList.add('critical');
    $.contextGauge.classList.add('critical');
  } else if (pct >= 50) {
    $.contextGaugeFill.classList.add('warning');
    $.contextGauge.classList.add('warning');
  }

  $.contextGaugeLabel.textContent = `${formatTokens(total)}/${formatTokens(limit)} · ${pct.toFixed(0)}%`;

  $.contextGauge.title = [
    `Input: ${formatTokens(tokens.input)}`,
    `Output: ${formatTokens(tokens.output)}`,
    `Cache Read: ${formatTokens(tokens.cacheRead)}`,
    `Cache Create: ${formatTokens(tokens.cacheCreation)}`,
    `Total: ${formatTokens(total)} / ${formatTokens(limit)} (${pct.toFixed(1)}%)`,
  ].join('\n');
}

export function updateContextGauge(input, output, cacheRead, cacheCreation, contextWindow) {
  // Use values directly from SDK — input_tokens already reflects full conversation context
  const tokens = {
    input: input || 0,
    output: output || 0,
    cacheRead: cacheRead || 0,
    cacheCreation: cacheCreation || 0,
    contextWindow: contextWindow || getState('sessionTokens')?.contextWindow || null,
  };
  setState('sessionTokens', tokens);
  renderGauge(tokens);
}

export function resetContextGauge() {
  const fresh = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, contextWindow: null };
  setState('sessionTokens', fresh);
  if ($.contextGauge) $.contextGauge.classList.add('hidden');
  if (sbGaugeSep) sbGaugeSep.classList.add('hidden');
}

export async function loadContextGauge(sessionId) {
  if (!sessionId) return;
  try {
    const messages = await (await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages-single`)).json();
    // Use only the last result message — SDK input_tokens already includes full conversation history
    let lastResult = null;
    for (const msg of messages) {
      if (msg.role === 'result') lastResult = msg;
    }
    if (!lastResult) {
      if ($.contextGauge) $.contextGauge.classList.add('hidden');
      return;
    }
    const data = JSON.parse(lastResult.content);
    const tokens = {
      input: data.input_tokens || 0,
      output: data.output_tokens || 0,
      cacheRead: data.cache_read_tokens || 0,
      cacheCreation: data.cache_creation_tokens || 0,
      contextWindow: data.context_window || null,
    };
    setState('sessionTokens', tokens);
    const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
    if (total > 0) {
      renderGauge(tokens);
    } else if ($.contextGauge) {
      $.contextGauge.classList.add('hidden');
    }
  } catch (err) {
    console.error('Failed to load context gauge:', err);
  }
}
