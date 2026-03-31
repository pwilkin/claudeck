// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock tab-sdk ────────────────────────────────────────────────────────────

const registeredTabs = {};
vi.mock("../../../public/js/ui/tab-sdk.js", () => ({
  registerTab: vi.fn((config) => { registeredTabs[config.id] = config; }),
}));

// ── Mock commands ───────────────────────────────────────────────────────────

const registeredCommands = {};
vi.mock("../../../public/js/ui/commands.js", () => ({
  registerCommand: vi.fn((name, config) => { registeredCommands[name] = config; }),
  commandRegistry: registeredCommands,
}));

// ── Mock right-panel ────────────────────────────────────────────────────────

vi.mock("../../../public/js/ui/right-panel.js", () => ({
  openRightPanel: vi.fn(),
}));

// ── Mock projects ───────────────────────────────────────────────────────────

vi.mock("../../../public/js/features/projects.js", () => ({
  loadProjectCommands: vi.fn(),
}));

// ── Mock api helpers used by skills-manager ─────────────────────────────────

const mockApi = {
  fetchInstalledSkills: vi.fn(),
  installSkillFromPath: vi.fn(),
  installSkillFromArchive: vi.fn(),
  uninstallSkill: vi.fn(),
  toggleSkill: vi.fn(),
};

// ── Import modules ──────────────────────────────────────────────────────────

await import("../../../public/js/panels/skills-manager.js");

// ── Tests ───────────────────────────────────────────────────────────────────

describe("skills-manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    localStorage.removeItem("claudeck-skill-scope");
  });

  describe("tab registration", () => {
    it("registers a tab with id 'skills'", () => {
      expect(registeredTabs.skills).toBeDefined();
      expect(registeredTabs.skills.id).toBe("skills");
      expect(registeredTabs.skills.title).toBe("Skills");
    });

    it("has lazy loading enabled", () => {
      expect(registeredTabs.skills.lazy).toBe(true);
    });

    it("has an init function", () => {
      expect(typeof registeredTabs.skills.init).toBe("function");
    });
  });

  describe("/skills command", () => {
    it("registers /skills command", () => {
      expect(registeredCommands.skills).toBeDefined();
      expect(registeredCommands.skills.category).toBe("app");
    });
  });

  describe("init function", () => {
    it("returns an HTMLElement", () => {
      const ctx = {
        api: mockApi,
        on: vi.fn(),
        getProjectPath: () => "/test/project",
        getSessionId: () => "session-1",
      };
      mockApi.fetchInstalledSkills.mockResolvedValue([]);

      const el = registeredTabs.skills.init(ctx);
      expect(el).toBeInstanceOf(HTMLElement);
      expect(el.className).toBe("skills-panel");
    });
  });

  describe("panel layout", () => {
    it("shows add skill buttons", async () => {
      const ctx = {
        api: mockApi,
        on: vi.fn(),
        getProjectPath: () => "/test",
        getSessionId: () => "s1",
      };
      mockApi.fetchInstalledSkills.mockResolvedValue([]);

      const el = registeredTabs.skills.init(ctx);
      document.body.appendChild(el);
      await new Promise((r) => setTimeout(r, 50));

      expect(el.querySelector(".skills-add-section")).not.toBeNull();
      expect(el.querySelector(".skills-add-btns")).not.toBeNull();

      const btns = el.querySelectorAll(".skills-add-btn");
      expect(btns.length).toBe(3);
      expect(btns[0].textContent).toContain("From Directory");
      expect(btns[1].textContent).toContain("From GitHub");
      expect(btns[2].textContent).toContain("From Archive");
    });

    it("shows installed skills header", async () => {
      const ctx = {
        api: mockApi,
        on: vi.fn(),
        getProjectPath: () => "/test",
        getSessionId: () => "s1",
      };
      mockApi.fetchInstalledSkills.mockResolvedValue([]);

      const el = registeredTabs.skills.init(ctx);
      document.body.appendChild(el);
      await new Promise((r) => setTimeout(r, 50));

      expect(el.querySelector(".skills-installed-header")).not.toBeNull();
      expect(el.querySelector(".skills-installed-header").textContent).toBe("Installed Skills");
    });
  });

  describe("installed tab", () => {
    it("shows empty state when no skills installed", async () => {
      const ctx = {
        api: mockApi,
        on: vi.fn(),
        getProjectPath: () => "/test",
        getSessionId: () => "s1",
      };
      mockApi.fetchInstalledSkills.mockResolvedValue([]);

      const el = registeredTabs.skills.init(ctx);
      document.body.appendChild(el);
      await new Promise((r) => setTimeout(r, 50));

      const empty = el.querySelector(".skills-empty-state");
      expect(empty).not.toBeNull();
      expect(empty.textContent).toContain("No skills installed");
    });

    it("renders installed skills grouped by scope", async () => {
      const ctx = {
        api: mockApi,
        on: vi.fn(),
        getProjectPath: () => "/test",
        getSessionId: () => "s1",
      };
      mockApi.fetchInstalledSkills.mockResolvedValue([
        { name: "skill-a", dirName: "skill-a", description: "Desc A", scope: "project", enabled: true, path: "/test/.claude/skills/skill-a" },
        { name: "skill-b", dirName: "skill-b", description: "Desc B", scope: "global", enabled: false, path: "/home/.claude/skills/skill-b" },
      ]);

      const el = registeredTabs.skills.init(ctx);
      document.body.appendChild(el);
      await new Promise((r) => setTimeout(r, 50));

      const headers = el.querySelectorAll(".skills-scope-header");
      expect(headers.length).toBe(2);
      expect(headers[0].textContent).toBe("Project");
      expect(headers[1].textContent).toBe("Global");

      const rows = el.querySelectorAll(".skill-installed-row");
      expect(rows.length).toBe(2);
    });

    it("shows toggle switch for each installed skill", async () => {
      const ctx = {
        api: mockApi,
        on: vi.fn(),
        getProjectPath: () => "/test",
        getSessionId: () => "s1",
      };
      mockApi.fetchInstalledSkills.mockResolvedValue([
        { name: "skill-a", dirName: "skill-a", description: "Desc A", scope: "project", enabled: true, path: "/test/.claude/skills/skill-a" },
      ]);

      const el = registeredTabs.skills.init(ctx);
      document.body.appendChild(el);
      await new Promise((r) => setTimeout(r, 50));

      const toggle = el.querySelector(".skill-toggle");
      expect(toggle).not.toBeNull();
      expect(toggle.querySelector("input[type='checkbox']").checked).toBe(true);
    });

    it("shows uninstall button for each installed skill", async () => {
      const ctx = {
        api: mockApi,
        on: vi.fn(),
        getProjectPath: () => "/test",
        getSessionId: () => "s1",
      };
      mockApi.fetchInstalledSkills.mockResolvedValue([
        { name: "skill-a", dirName: "skill-a", description: "Desc A", scope: "project", enabled: true, path: "/test/.claude/skills/skill-a" },
      ]);

      const el = registeredTabs.skills.init(ctx);
      document.body.appendChild(el);
      await new Promise((r) => setTimeout(r, 50));

      const delBtn = el.querySelector(".skill-uninstall-btn");
      expect(delBtn).not.toBeNull();
    });
  });
});

// ── renderMessagesIntoPane skill rendering ───────────────────────────────────

describe("renderMessagesIntoPane skill messages", () => {
  it("renders skill-used indicator for Skill tool_use messages on reload", async () => {
    const { renderMessagesIntoPane } = await import("../../../public/js/ui/messages.js");

    const messagesDiv = document.createElement("div");
    const pane = { messagesDiv, currentAssistantMsg: null };

    const messages = [
      { id: 1, role: "tool", content: JSON.stringify({ id: "t1", name: "Skill", input: { skill: "code-review", description: "Review code" } }) },
    ];

    renderMessagesIntoPane(messages, pane);

    const skillMsg = messagesDiv.querySelector(".skill-used-message");
    expect(skillMsg).not.toBeNull();
    expect(skillMsg.querySelector(".skill-used-name").textContent).toContain("code-review");
  });

  it("renders explicit skill role messages on reload", async () => {
    const { renderMessagesIntoPane } = await import("../../../public/js/ui/messages.js");

    const messagesDiv = document.createElement("div");
    const pane = { messagesDiv, currentAssistantMsg: null };

    const messages = [
      { id: 1, role: "skill", content: JSON.stringify({ skill: "commit-msg", description: "Generate commits" }) },
    ];

    renderMessagesIntoPane(messages, pane);

    const skillMsg = messagesDiv.querySelector(".skill-used-message");
    expect(skillMsg).not.toBeNull();
    expect(skillMsg.querySelector(".skill-used-name").textContent).toContain("commit-msg");
  });
});

// ── addSkillUsedMessage tests ───────────────────────────────────────────────

describe("addSkillUsedMessage", () => {
  it("renders skill-used message with name and description", async () => {
    const { addSkillUsedMessage } = await import("../../../public/js/ui/messages.js");

    const messagesDiv = document.createElement("div");
    const pane = { messagesDiv, currentAssistantMsg: null };

    addSkillUsedMessage("code-review", "Perform code review", pane);

    const msg = messagesDiv.querySelector(".skill-used-message");
    expect(msg).not.toBeNull();
    expect(msg.querySelector(".skill-used-name").textContent).toContain("code-review");
    expect(msg.querySelector(".skill-used-desc").textContent).toContain("Perform code review");
  });

  it("renders without description when not provided", async () => {
    const { addSkillUsedMessage } = await import("../../../public/js/ui/messages.js");

    const messagesDiv = document.createElement("div");
    const pane = { messagesDiv, currentAssistantMsg: null };

    addSkillUsedMessage("my-skill", "", pane);

    const msg = messagesDiv.querySelector(".skill-used-message");
    expect(msg).not.toBeNull();
    expect(msg.querySelector(".skill-used-name").textContent).toContain("my-skill");
    expect(msg.querySelector(".skill-used-desc")).toBeNull();
  });
});
