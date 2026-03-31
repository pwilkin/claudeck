// Claude Code 5-hour session usage indicator (status bar)
import { $ } from '../core/dom.js';

const REFRESH_INTERVAL_MS = 30_000;

let lastInfo = null;
let timerId = null;

function formatTimeLeft(resetsAtSec) {
  const msLeft = resetsAtSec * 1000 - Date.now();
  if (msLeft <= 0) return '0m';
  const h = Math.floor(msLeft / 3_600_000);
  const m = Math.floor((msLeft % 3_600_000) / 60_000);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

function renderSessionUsage(info) {
  if (!$.sessionUsage) return;

  const { status, utilization, resetsAt, rateLimitType } = info;

  if (utilization == null) return;
  const pct = Math.min(utilization * 100, 100);

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

function startRefreshTimer() {
  stopRefreshTimer();
  timerId = setInterval(() => {
    if (lastInfo) renderSessionUsage(lastInfo);
  }, REFRESH_INTERVAL_MS);
}

function stopRefreshTimer() {
  if (timerId != null) {
    clearInterval(timerId);
    timerId = null;
  }
}

export function updateSessionUsage(info) {
  lastInfo = info;
  renderSessionUsage(info);
  if (!timerId) startRefreshTimer();
}

export function resetSessionUsage() {
  lastInfo = null;
  stopRefreshTimer();
  if ($.sessionUsage) $.sessionUsage.classList.add('hidden');
  if ($.sessionUsageSep) $.sessionUsageSep.classList.add('hidden');
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && lastInfo) {
    renderSessionUsage(lastInfo);
  }
});
