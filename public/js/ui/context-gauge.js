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
  // Context window usage = total input tokens (input_tokens is non-cached, cache tokens are the rest)
  const totalInput = tokens.input + tokens.cacheRead + tokens.cacheCreation;
  const pct = Math.min((totalInput / limit) * 100, 100);

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

  $.contextGaugeLabel.textContent = `${formatTokens(totalInput)}/${formatTokens(limit)} · ${pct.toFixed(0)}%`;

  $.contextGauge.title = [
    `Input: ${formatTokens(tokens.input)}`,
    `Output: ${formatTokens(tokens.output)}`,
    `Cache Read: ${formatTokens(tokens.cacheRead)}`,
    `Cache Create: ${formatTokens(tokens.cacheCreation)}`,
    `Context: ${formatTokens(totalInput)} / ${formatTokens(limit)} (${pct.toFixed(1)}%)`,
  ].join('\n');
}

export function updateContextGauge(input, output, cacheRead, cacheCreation, contextWindow) {
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

/** Live context usage from SDK's getContextUsage() — overrides with accurate data */
export function updateContextGaugeLive(totalTokens, maxTokens, percentage, categories) {
  if (!$.contextGauge) return;

  const pct = Math.min(percentage || 0, 100);

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

  $.contextGaugeLabel.textContent = `${formatTokens(totalTokens)}/${formatTokens(maxTokens)} · ${pct.toFixed(0)}%`;

  const catLines = (categories || []).map(c => `${c.name}: ${formatTokens(c.tokens)}`);
  $.contextGauge.title = [
    ...catLines,
    `Total: ${formatTokens(totalTokens)} / ${formatTokens(maxTokens)} (${pct.toFixed(1)}%)`,
  ].join('\n');

  // Update stored context window for fallback rendering
  const prev = getState('sessionTokens') || {};
  setState('sessionTokens', { ...prev, contextWindow: maxTokens });
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
    const row = await (await fetch(`/api/stats/session-cost/${encodeURIComponent(sessionId)}`)).json();
    if (!row || !row.input_tokens) {
      if ($.contextGauge) $.contextGauge.classList.add('hidden');
      return;
    }
    const tokens = {
      input: row.input_tokens || 0,
      output: row.output_tokens || 0,
      cacheRead: row.cache_read_tokens || 0,
      cacheCreation: row.cache_creation_tokens || 0,
      contextWindow: row.context_window || null,
    };
    setState('sessionTokens', tokens);
    const totalInput = tokens.input + tokens.cacheRead + tokens.cacheCreation;
    if (totalInput > 0) {
      renderGauge(tokens);
    } else if ($.contextGauge) {
      $.contextGauge.classList.add('hidden');
    }
  } catch (err) {
    console.error('Failed to load context gauge:', err);
  }
}
