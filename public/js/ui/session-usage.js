// Claude Code 5-hour session usage indicator (status bar)
import { $ } from '../core/dom.js';

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

function formatTimeLeft(resetsAtSec) {
  const msLeft = resetsAtSec * 1000 - Date.now();
  if (msLeft <= 0) return '0m';
  const h = Math.floor(msLeft / 3_600_000);
  const m = Math.floor((msLeft % 3_600_000) / 60_000);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

export function updateSessionUsage(info) {
  if (!$.sessionUsage) return;

  const { status, utilization, resetsAt, rateLimitType } = info;

  // Compute percentage: use SDK utilization when available, otherwise derive from resetsAt
  let pct;
  if (utilization != null) {
    pct = Math.min(utilization * 100, 100);
  } else if (resetsAt) {
    const windowStartMs = resetsAt * 1000 - FIVE_HOURS_MS;
    const elapsed = Date.now() - windowStartMs;
    pct = Math.min((elapsed / FIVE_HOURS_MS) * 100, 100);
  } else {
    return; // nothing to show
  }

  const isWarning = status === 'allowed_warning' || pct >= 75;
  const isCritical = status === 'rejected' || pct >= 90;

  $.sessionUsageFill.style.width = pct.toFixed(1) + '%';

  $.sessionUsageFill.classList.remove('warning', 'critical');
  $.sessionUsage.classList.remove('warning', 'critical');
  if (isCritical) {
    $.sessionUsageFill.classList.add('critical');
    $.sessionUsage.classList.add('critical');
  } else if (isWarning) {
    $.sessionUsageFill.classList.add('warning');
    $.sessionUsage.classList.add('warning');
  }

  const timeLeft = resetsAt ? ` · ${formatTimeLeft(resetsAt)}` : '';
  $.sessionUsageLabel.textContent = `${pct.toFixed(0)}%${timeLeft}`;

  const typeLabel = rateLimitType === 'five_hour' ? '5h session' : (rateLimitType || 'session');
  $.sessionUsage.title = [
    `Claude Code ${typeLabel} usage: ${pct.toFixed(1)}%`,
    resetsAt ? `Resets in: ${formatTimeLeft(resetsAt)}` : '',
    `Status: ${status}`,
  ].filter(Boolean).join('\n');

  $.sessionUsage.classList.remove('hidden');
  if ($.sessionUsageSep) $.sessionUsageSep.classList.remove('hidden');
}
