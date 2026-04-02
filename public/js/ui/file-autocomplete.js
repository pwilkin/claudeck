// @ file autocomplete — inline file picker triggered by typing @
import { escapeHtml } from '../core/utils.js';
import { searchFiles } from '../core/api.js';
import { $ } from '../core/dom.js';
import { dismissAutocomplete } from './commands.js';

const MAX_RESULTS = 15;
const DEBOUNCE_MS = 150;

// Track per-pane state
const paneState = new WeakMap();

function getOrCreate(pane) {
  if (!paneState.has(pane)) {
    paneState.set(pane, { timer: null, activeQuery: '' });
  }
  return paneState.get(pane);
}

function getFileAutocompleteEl(pane) {
  return pane.fileAutocompleteEl || null;
}

/** Find the @ trigger position: the last unescaped @ before the cursor that starts a token */
function findAtTrigger(text, cursorPos) {
  // Search backwards from cursor for @
  const before = text.slice(0, cursorPos);
  const atIdx = before.lastIndexOf('@');
  if (atIdx < 0) return null;

  // @ must be at start of input or preceded by whitespace
  if (atIdx > 0 && !/\s/.test(before[atIdx - 1])) return null;

  // Extract the query after @
  const query = before.slice(atIdx + 1);

  // Query must not contain newlines or multiple spaces
  if (/\n/.test(query)) return null;

  return { atIdx, query };
}

function getFileIcon(name) {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  const icons = {
    js: '📜', jsx: '📜', ts: '📜', tsx: '📜', mjs: '📜', cjs: '📜',
    json: '⚙', yaml: '⚙', yml: '⚙', toml: '⚙', ini: '⚙',
    html: '🌐', css: '🎨', scss: '🎨', less: '🎨',
    md: '📄', txt: '📄', rst: '📄',
    py: '🐍', rb: '💎', go: '🔷', rs: '🦀', java: '☕', c: '⚡', cpp: '⚡', h: '⚡',
    sh: '🐚', bash: '🐚', zsh: '🐚',
    sql: '🗃', csv: '📊',
  };
  return icons[ext] || (name.includes('.') ? '📄' : '📁');
}

async function fetchResults(query, pane) {
  const projectPath = $.projectSelect?.value;
  if (!projectPath) return [];
  try {
    const results = await searchFiles(projectPath, query);
    return (results || []).slice(0, MAX_RESULTS);
  } catch {
    return [];
  }
}

function renderResults(results, pane) {
  const el = getFileAutocompleteEl(pane);
  if (!el) return;

  if (results.length === 0) {
    dismissFileAutocomplete(pane);
    return;
  }

  el.innerHTML = '';
  results.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'file-autocomplete-item' + (i === 0 ? ' active' : '');
    div.dataset.index = i;
    div.dataset.path = item.path;
    const icon = getFileIcon(item.name);
    div.innerHTML = `
      <span class="file-icon">${icon}</span>
      <span class="file-path">${escapeHtml(item.path)}</span>
      <span class="file-type">${item.type === 'dir' ? 'dir' : ''}</span>
    `;
    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectFile(pane, item.path);
    });
    el.appendChild(div);
  });

  pane._fileAutocompleteIndex = 0;
  el.classList.remove('hidden');
  // Dismiss slash autocomplete if it was open
  dismissAutocomplete(pane);
}

function selectFile(pane, filePath) {
  const input = pane.messageInput;
  const text = input.value;
  const cursorPos = input.selectionStart;
  const trigger = findAtTrigger(text, cursorPos);
  if (!trigger) return;

  // Replace @query with @filepath (with trailing space)
  const before = text.slice(0, trigger.atIdx);
  const after = text.slice(cursorPos);
  input.value = before + '@' + filePath + ' ' + after;

  // Place cursor after the inserted path
  const newPos = trigger.atIdx + 1 + filePath.length + 1;
  input.selectionStart = input.selectionEnd = newPos;

  dismissFileAutocomplete(pane);
  input.focus();
  // Trigger input event for auto-resize
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function handleFileAutocomplete(pane) {
  const el = getFileAutocompleteEl(pane);
  if (!el) return;

  const input = pane.messageInput;
  const text = input.value;
  const cursorPos = input.selectionStart;

  const trigger = findAtTrigger(text, cursorPos);
  if (!trigger) {
    dismissFileAutocomplete(pane);
    return;
  }

  const query = trigger.query;
  // Need at least 1 char to search
  if (query.length < 1) {
    dismissFileAutocomplete(pane);
    return;
  }

  const state = getOrCreate(pane);
  if (state.activeQuery === query) return; // already showing results for this query

  // Debounce API calls
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    state.activeQuery = query;
    const results = await fetchResults(query, pane);
    // Verify trigger is still active (user may have typed more)
    const currentTrigger = findAtTrigger(input.value, input.selectionStart);
    if (currentTrigger && currentTrigger.query === query) {
      renderResults(results, pane);
    }
  }, DEBOUNCE_MS);
}

export function dismissFileAutocomplete(pane) {
  const el = getFileAutocompleteEl(pane);
  if (el) {
    el.classList.add('hidden');
    el.innerHTML = '';
    pane._fileAutocompleteIndex = -1;
  }
  const state = getOrCreate(pane);
  state.activeQuery = '';
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

export function handleFileAutocompleteKeydown(e, pane) {
  const el = getFileAutocompleteEl(pane);
  if (!el || el.classList.contains('hidden')) return false;

  const items = el.querySelectorAll('.file-autocomplete-item');
  if (items.length === 0) return false;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    pane._fileAutocompleteIndex = Math.min(pane._fileAutocompleteIndex + 1, items.length - 1);
    items.forEach((it, i) => it.classList.toggle('active', i === pane._fileAutocompleteIndex));
    items[pane._fileAutocompleteIndex].scrollIntoView({ block: 'nearest' });
    return true;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    pane._fileAutocompleteIndex = Math.max(pane._fileAutocompleteIndex - 1, 0);
    items.forEach((it, i) => it.classList.toggle('active', i === pane._fileAutocompleteIndex));
    items[pane._fileAutocompleteIndex].scrollIntoView({ block: 'nearest' });
    return true;
  }

  if (e.key === 'Tab' || (e.key === 'Enter' && pane._fileAutocompleteIndex >= 0)) {
    e.preventDefault();
    const active = items[pane._fileAutocompleteIndex];
    if (active) {
      selectFile(pane, active.dataset.path);
    }
    return true;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    dismissFileAutocomplete(pane);
    return true;
  }

  return false;
}
