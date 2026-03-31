// Skills — local skill management panel
import { registerTab } from '../ui/tab-sdk.js';
import { registerCommand } from '../ui/commands.js';

const ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
const FOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>';
const ARCHIVE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';

let ctx = null;
let root = null;
let installedCache = [];
let defaultScope = localStorage.getItem("claudeck-skill-scope") || "project";

// ── Tab registration ────────────────────────────────────

registerTab({
  id: "skills",
  title: "Skills",
  icon: ICON,
  lazy: true,

  init(_ctx) {
    ctx = _ctx;
    root = document.createElement("div");
    root.className = "skills-panel";
    renderPanel();

    ctx.on("projectChanged", () => {
      refreshInstalled();
    });

    return root;
  },

  onActivate() {
    refreshInstalled();
  },
});

// ── /skills command ─────────────────────────────────────

registerCommand("skills", {
  category: "app",
  description: "Open Skills Manager",
  execute() {
    import("../ui/right-panel.js").then((m) => m.openRightPanel("skills"));
  },
});

// ── Panel rendering ─────────────────────────────────────

function renderPanel() {
  root.innerHTML = "";

  // Add skill section
  const addSection = document.createElement("div");
  addSection.className = "skills-add-section";

  const addHeader = document.createElement("div");
  addHeader.className = "skills-add-header";
  addHeader.innerHTML = `<span>Add Skill</span>`;

  const addBtns = document.createElement("div");
  addBtns.className = "skills-add-btns";

  const dirBtn = document.createElement("button");
  dirBtn.className = "skills-add-btn";
  dirBtn.innerHTML = `${FOLDER_SVG} From Directory`;
  dirBtn.addEventListener("click", () => showAddFromDirectory());

  const archiveBtn = document.createElement("button");
  archiveBtn.className = "skills-add-btn";
  archiveBtn.innerHTML = `${ARCHIVE_SVG} From Archive`;
  archiveBtn.addEventListener("click", () => showAddFromArchive());

  addBtns.appendChild(dirBtn);
  addBtns.appendChild(archiveBtn);
  addSection.appendChild(addHeader);
  addSection.appendChild(addBtns);
  root.appendChild(addSection);

  // Separator
  const sep = document.createElement("div");
  sep.className = "skills-separator";
  root.appendChild(sep);

  // Installed skills
  const installedHeader = document.createElement("div");
  installedHeader.className = "skills-installed-header";
  installedHeader.textContent = "Installed Skills";
  root.appendChild(installedHeader);

  const installedList = document.createElement("div");
  installedList.className = "skills-installed-list";
  installedList.id = "skills-installed-list";
  root.appendChild(installedList);

  refreshInstalled();
}

// ── Add from directory ──────────────────────────────────

function showAddFromDirectory() {
  const overlay = document.createElement("div");
  overlay.className = "skills-modal-overlay";

  const dialog = document.createElement("div");
  dialog.className = "skills-modal";
  dialog.innerHTML = `
    <div class="skills-modal-title">Add Skill from Directory</div>
    <div class="skills-modal-desc">Enter the path to a directory containing a SKILL.md file.</div>
    <input class="skills-modal-input" type="text" placeholder="/path/to/skill-directory" autocomplete="off">
    <div class="skills-modal-scope-row">
      <label>Install to:</label>
      <select class="skills-modal-scope">
        <option value="project" ${defaultScope === "project" ? "selected" : ""}>Project (.claude/skills/)</option>
        <option value="global" ${defaultScope === "global" ? "selected" : ""}>Global (~/.claude/skills/)</option>
      </select>
    </div>
    <div class="skills-modal-actions">
      <button class="skills-modal-cancel">Cancel</button>
      <button class="skills-modal-ok">Add Skill</button>
    </div>
    <div class="skills-modal-error"></div>
  `;

  const input = dialog.querySelector(".skills-modal-input");
  const scopeSelect = dialog.querySelector(".skills-modal-scope");
  const okBtn = dialog.querySelector(".skills-modal-ok");
  const cancelBtn = dialog.querySelector(".skills-modal-cancel");
  const errEl = dialog.querySelector(".skills-modal-error");

  const close = () => overlay.remove();

  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  okBtn.addEventListener("click", async () => {
    const sourcePath = input.value.trim();
    if (!sourcePath) { errEl.textContent = "Please enter a directory path"; return; }
    okBtn.disabled = true;
    okBtn.textContent = "Adding...";
    errEl.textContent = "";

    try {
      const res = await ctx.api.installSkillFromPath({
        sourcePath,
        scope: scopeSelect.value,
        projectPath: getProjectPath(),
      });
      if (res.error) { errEl.textContent = res.error; okBtn.disabled = false; okBtn.textContent = "Add Skill"; return; }
      showSkillToast(`Added "${res.name}"`, "success");
      close();
      refreshInstalled();
      refreshProjectCommands();
    } catch (err) {
      errEl.textContent = err.message || "Failed to add skill";
      okBtn.disabled = false;
      okBtn.textContent = "Add Skill";
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") okBtn.click();
    if (e.key === "Escape") close();
  });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  input.focus();
}

// ── Add from archive ────────────────────────────────────

function showAddFromArchive() {
  const overlay = document.createElement("div");
  overlay.className = "skills-modal-overlay";

  const dialog = document.createElement("div");
  dialog.className = "skills-modal";
  dialog.innerHTML = `
    <div class="skills-modal-title">Add Skill from Archive</div>
    <div class="skills-modal-desc">Select a .zip or .tar.gz file containing a SKILL.md file.</div>
    <div class="skills-modal-drop-zone" tabindex="0">
      <div class="skills-modal-drop-icon">${ARCHIVE_SVG}</div>
      <div class="skills-modal-drop-text">Click to select file, or drag & drop</div>
      <div class="skills-modal-drop-hint">Supports .zip and .tar.gz</div>
      <input class="skills-modal-file-input" type="file" accept=".zip,.tar.gz,.tgz" hidden>
    </div>
    <div class="skills-modal-file-name"></div>
    <div class="skills-modal-scope-row">
      <label>Install to:</label>
      <select class="skills-modal-scope">
        <option value="project" ${defaultScope === "project" ? "selected" : ""}>Project (.claude/skills/)</option>
        <option value="global" ${defaultScope === "global" ? "selected" : ""}>Global (~/.claude/skills/)</option>
      </select>
    </div>
    <div class="skills-modal-actions">
      <button class="skills-modal-cancel">Cancel</button>
      <button class="skills-modal-ok" disabled>Add Skill</button>
    </div>
    <div class="skills-modal-error"></div>
  `;

  const dropZone = dialog.querySelector(".skills-modal-drop-zone");
  const fileInput = dialog.querySelector(".skills-modal-file-input");
  const fileNameEl = dialog.querySelector(".skills-modal-file-name");
  const scopeSelect = dialog.querySelector(".skills-modal-scope");
  const okBtn = dialog.querySelector(".skills-modal-ok");
  const cancelBtn = dialog.querySelector(".skills-modal-cancel");
  const errEl = dialog.querySelector(".skills-modal-error");

  let selectedFile = null;

  const close = () => overlay.remove();

  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  function handleFile(file) {
    if (!file) return;
    const ext = file.name.toLowerCase();
    if (!ext.endsWith(".zip") && !ext.endsWith(".tar.gz") && !ext.endsWith(".tgz")) {
      errEl.textContent = "Only .zip and .tar.gz files are supported";
      return;
    }
    selectedFile = file;
    fileNameEl.textContent = file.name;
    okBtn.disabled = false;
    errEl.textContent = "";
  }

  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  okBtn.addEventListener("click", async () => {
    if (!selectedFile) return;
    okBtn.disabled = true;
    okBtn.textContent = "Adding...";
    errEl.textContent = "";

    try {
      const res = await ctx.api.installSkillFromArchive({
        file: selectedFile,
        scope: scopeSelect.value,
        projectPath: getProjectPath(),
      });
      if (res.error) { errEl.textContent = res.error; okBtn.disabled = false; okBtn.textContent = "Add Skill"; return; }
      showSkillToast(`Added "${res.name}"`, "success");
      close();
      refreshInstalled();
      refreshProjectCommands();
    } catch (err) {
      errEl.textContent = err.message || "Failed to add skill";
      okBtn.disabled = false;
      okBtn.textContent = "Add Skill";
    }
  });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// ── Installed skills ────────────────────────────────────

async function refreshInstalled() {
  try {
    installedCache = await ctx.api.fetchInstalledSkills(getProjectPath());
  } catch {
    installedCache = [];
  }
  renderInstalledList();
}

function renderInstalledList() {
  const list = document.getElementById("skills-installed-list");
  if (!list) return;
  list.innerHTML = "";

  if (installedCache.length === 0) {
    const empty = document.createElement("div");
    empty.className = "skills-empty-state";
    empty.innerHTML = `${ICON}<span>No skills installed</span><span class="skills-empty-hint">Add a skill using the buttons above</span>`;
    list.appendChild(empty);
    return;
  }

  const projectSkills = installedCache.filter((s) => s.scope === "project");
  const globalSkills = installedCache.filter((s) => s.scope === "global");

  if (projectSkills.length > 0) {
    const header = document.createElement("div");
    header.className = "skills-scope-header";
    header.textContent = "Project";
    list.appendChild(header);
    for (const skill of projectSkills) list.appendChild(createInstalledRow(skill));
  }

  if (globalSkills.length > 0) {
    const header = document.createElement("div");
    header.className = "skills-scope-header";
    header.textContent = "Global";
    list.appendChild(header);
    for (const skill of globalSkills) list.appendChild(createInstalledRow(skill));
  }
}

function createInstalledRow(skill) {
  const row = document.createElement("div");
  row.className = "skill-installed-row";

  const info = document.createElement("div");
  info.className = "skill-installed-info";
  info.innerHTML = `<div class="skill-installed-name">${skill.name}</div><div class="skill-installed-desc">${skill.description || ""}</div>`;

  const badge = document.createElement("span");
  badge.className = `skill-scope-badge ${skill.scope}`;
  badge.textContent = skill.scope;

  // Toggle
  const toggle = document.createElement("label");
  toggle.className = "skill-toggle";
  toggle.title = skill.enabled ? "Disable" : "Enable";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = skill.enabled;
  const slider = document.createElement("span");
  slider.className = "skill-toggle-slider";
  toggle.appendChild(checkbox);
  toggle.appendChild(slider);

  checkbox.addEventListener("change", async () => {
    try {
      await ctx.api.toggleSkill(skill.dirName, skill.scope, getProjectPath());
      refreshProjectCommands();
    } catch {
      checkbox.checked = !checkbox.checked;
    }
  });

  // Uninstall
  const delBtn = document.createElement("button");
  delBtn.className = "skill-uninstall-btn";
  delBtn.title = "Uninstall";
  delBtn.innerHTML = TRASH_SVG;
  delBtn.addEventListener("click", () => {
    showConfirm({
      title: `Uninstall "${skill.name}"?`,
      message: "This will remove the skill files from disk.",
      confirmLabel: "Uninstall",
      danger: true,
      onConfirm: async () => {
        try {
          await ctx.api.uninstallSkill(skill.dirName, skill.scope, getProjectPath());
          showSkillToast(`Uninstalled "${skill.name}"`, "success");
          refreshInstalled();
          refreshProjectCommands();
        } catch {
          showSkillToast(`Failed to uninstall "${skill.name}"`, "error");
        }
      },
    });
  });

  row.appendChild(info);
  row.appendChild(badge);
  row.appendChild(toggle);
  row.appendChild(delBtn);
  return row;
}

// ── Helpers ─────────────────────────────────────────────

function getProjectPath() {
  return ctx ? ctx.getProjectPath() : "";
}

function showConfirm({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
  const overlay = document.createElement("div");
  overlay.className = "skills-confirm-overlay";

  const dialog = document.createElement("div");
  dialog.className = "skills-confirm-dialog";

  dialog.innerHTML = `
    <div class="skills-confirm-title">${title}</div>
    <div class="skills-confirm-message">${message}</div>
    <div class="skills-confirm-actions">
      <button class="skills-confirm-cancel">Cancel</button>
      <button class="skills-confirm-ok ${danger ? "danger" : ""}">${confirmLabel}</button>
    </div>
  `;

  const close = () => overlay.remove();
  dialog.querySelector(".skills-confirm-cancel").addEventListener("click", close);
  dialog.querySelector(".skills-confirm-ok").addEventListener("click", () => {
    close();
    onConfirm();
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.querySelector(".skills-confirm-cancel").focus();
}

function showSkillToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `bg-toast ${type === "error" ? "bg-toast-error" : ""}`;
  toast.innerHTML = `
    <span class="bg-toast-dot ${type === "error" ? "error" : ""}"></span>
    <div class="bg-toast-body">
      <div class="bg-toast-label"${type === "error" ? ' style="color:var(--error)"' : ""}>Skills</div>
      <div class="bg-toast-title">${message}</div>
    </div>
    <button class="bg-toast-close" title="Dismiss">&times;</button>
  `;

  toast.querySelector(".bg-toast-close").addEventListener("click", () => {
    toast.classList.add("toast-exit");
    toast.addEventListener("animationend", () => toast.remove());
  });

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add("toast-exit");
      toast.addEventListener("animationend", () => toast.remove());
    }
  }, 4000);
}

function refreshProjectCommands() {
  import("../features/projects.js").then(({ loadProjectCommands }) => loadProjectCommands());
}
