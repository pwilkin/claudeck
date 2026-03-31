// Skills — local skill management (install from directory, GitHub, or archive)
import { Router } from "express";
import { readFile, readdir, stat, mkdir, rm, rename, copyFile } from "fs/promises";
import { join, basename, extname } from "path";
import { homedir } from "os";
import { existsSync, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const router = Router();

// ── Helpers ─────────────────────────────────────────────

function skillDirs(projectPath) {
  const dirs = [join(homedir(), ".claude", "skills")];
  if (projectPath) {
    dirs.push(join(projectPath, ".claude", "skills"));
  }
  return dirs;
}

async function scanSkills(baseDir, scope) {
  const skills = [];
  try {
    const entries = await readdir(baseDir);
    for (const entry of entries) {
      try {
        const entryPath = join(baseDir, entry);
        const s = await stat(entryPath);
        if (!s.isDirectory()) continue;

        const enabledPath = join(entryPath, "SKILL.md");
        const disabledPath = join(entryPath, "SKILL.md.disabled");
        let skillFile = null;
        let enabled = true;

        if (existsSync(enabledPath)) {
          skillFile = enabledPath;
        } else if (existsSync(disabledPath)) {
          skillFile = disabledPath;
          enabled = false;
        } else {
          continue;
        }

        const content = await readFile(skillFile, "utf-8");
        let name = entry;
        let description = "";
        let argumentHint = "";

        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fm = fmMatch[1];
          const nameMatch = fm.match(/^name:\s*(.+)$/m);
          const descMatch = fm.match(/^description:\s*(.+)$/m);
          const argMatch = fm.match(/^argument-hint:\s*(.+)$/m);
          if (nameMatch) name = nameMatch[1].trim();
          if (descMatch) description = descMatch[1].trim();
          if (argMatch) argumentHint = argMatch[1].trim();
        }

        skills.push({ name, dirName: entry, description, argumentHint, scope, enabled, path: entryPath });
      } catch { /* skip unreadable */ }
    }
  } catch { /* directory doesn't exist */ }
  return skills;
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    || "skill";
}

async function findSkillMd(dir) {
  const entries = await readdir(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const entryStat = await stat(fullPath);
    if (entryStat.isDirectory()) {
      const result = await findSkillMd(fullPath);
      if (result) return result;
    } else if (entry.toUpperCase() === "SKILL.MD" || entry === "SKILL.md") {
      return dir;
    }
  }
  return null;
}

function parseGithubUrl(url) {
  const treeMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
  if (treeMatch) {
    return { owner: treeMatch[1], repo: treeMatch[2], branch: treeMatch[3], path: treeMatch[4] };
  }
  const blobMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/);
  if (blobMatch) {
    const dir = blobMatch[4].replace(/\/[^/]+$/, "");
    return { owner: blobMatch[1], repo: blobMatch[2], branch: blobMatch[3], path: dir };
  }
  const rawMatch = url.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)/);
  if (rawMatch) {
    const dir = rawMatch[4].replace(/\/[^/]+$/, "");
    return { owner: rawMatch[1], repo: rawMatch[2], branch: rawMatch[3], path: dir };
  }
  return null;
}

// ── Installed skills ────────────────────────────────────

router.get("/installed", async (req, res) => {
  try {
    const { projectPath } = req.query;
    const skills = [];
    for (const dir of skillDirs(projectPath)) {
      const scope = dir === join(homedir(), ".claude", "skills") ? "global" : "project";
      skills.push(...await scanSkills(dir, scope));
    }
    res.json(skills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Install from local directory path ───────────────────

router.post("/install-from-path", async (req, res) => {
  try {
    const { sourcePath, scope, projectPath } = req.body;

    if (!sourcePath || typeof sourcePath !== "string") {
      return res.status(400).json({ error: "sourcePath is required" });
    }

    if (!existsSync(sourcePath)) {
      return res.status(400).json({ error: "Source path does not exist" });
    }

    const s = await stat(sourcePath);
    if (!s.isDirectory()) {
      return res.status(400).json({ error: "Source path must be a directory" });
    }

    const hasSkill = existsSync(join(sourcePath, "SKILL.md")) ||
                     existsSync(join(sourcePath, "SKILL.md.disabled"));
    if (!hasSkill) {
      return res.status(400).json({ error: "No SKILL.md found in directory" });
    }

    const dirName = normalizeName(basename(sourcePath));
    const targetBase = scope === "global"
      ? join(homedir(), ".claude", "skills")
      : join(projectPath, ".claude", "skills");

    if (!projectPath && scope === "project") {
      return res.status(400).json({ error: "projectPath required for project scope" });
    }

    const targetDir = join(targetBase, dirName);
    await mkdir(targetDir, { recursive: true });

    const entries = await readdir(sourcePath);
    let filesCount = 0;
    for (const entry of entries) {
      const src = join(sourcePath, entry);
      const entryStat = await stat(src);
      if (entryStat.isFile()) {
        const normalized = entry.toUpperCase() === "SKILL.MD" ? "SKILL.md" : entry;
        await copyFile(src, join(targetDir, normalized));
        filesCount++;
      }
    }

    res.json({ success: true, path: targetDir, filesCount, name: dirName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Install from GitHub ─────────────────────────────────

router.post("/install-from-github", async (req, res) => {
  try {
    const { githubUrl, scope, projectPath } = req.body;

    if (!githubUrl || typeof githubUrl !== "string") {
      return res.status(400).json({ error: "githubUrl is required" });
    }

    if (!projectPath && scope === "project") {
      return res.status(400).json({ error: "projectPath required for project scope" });
    }

    const parsed = parseGithubUrl(githubUrl);
    if (!parsed) {
      return res.status(400).json({ error: "Could not parse GitHub URL. Use a github.com/owner/repo/tree/branch/path URL." });
    }

    const tmpDir = join(homedir(), ".claudeck", "tmp-skills");
    await mkdir(tmpDir, { recursive: true });
    const cloneDir = join(tmpDir, `gh-${Date.now()}`);

    const repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}.git`;
    await execAsync(`git clone --depth 1 --branch ${parsed.branch} --filter=blob:none --sparse "${repoUrl}" "${cloneDir}"`);
    await execAsync(`git -C "${cloneDir}" sparse-checkout set "${parsed.path}"`);

    const skillSource = join(cloneDir, parsed.path);
    if (!existsSync(skillSource)) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return res.status(404).json({ error: "Skill directory not found in repository" });
    }

    const hasSkill = existsSync(join(skillSource, "SKILL.md")) ||
                     existsSync(join(skillSource, "SKILL.md.disabled"));
    if (!hasSkill) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return res.status(400).json({ error: "No SKILL.md found in the specified path" });
    }

    const dirName = normalizeName(basename(parsed.path));
    const targetBase = scope === "global"
      ? join(homedir(), ".claude", "skills")
      : join(projectPath, ".claude", "skills");
    const targetDir = join(targetBase, dirName);
    await mkdir(targetDir, { recursive: true });

    const entries = await readdir(skillSource);
    let filesCount = 0;
    for (const entry of entries) {
      const src = join(skillSource, entry);
      const entryStat = await stat(src);
      if (entryStat.isFile()) {
        const normalized = entry.toUpperCase() === "SKILL.MD" ? "SKILL.md" : entry;
        await copyFile(src, join(targetDir, normalized));
        filesCount++;
      }
    }

    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    res.json({ success: true, path: targetDir, filesCount, name: dirName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Install from archive (zip/tar.gz) ───────────────────

router.post("/install-from-archive", async (req, res) => {
  try {
    const { scope, projectPath, fileName } = req.body;

    if (!projectPath && scope === "project") {
      return res.status(400).json({ error: "projectPath required for project scope" });
    }

    const archiveData = req.body.data;
    if (!archiveData) {
      return res.status(400).json({ error: "Archive data is required" });
    }

    const ext = extname(fileName || "").toLowerCase();
    if (ext !== ".zip" && ext !== ".gz" && ext !== ".tgz") {
      return res.status(400).json({ error: "Unsupported archive format. Use .zip or .tar.gz" });
    }

    const tmpDir = join(homedir(), ".claudeck", "tmp-skills");
    await mkdir(tmpDir, { recursive: true });
    const tmpFile = join(tmpDir, `upload-${Date.now()}${ext}`);
    const tmpOut = createWriteStream(tmpFile);
    await pipeline(Readable.from(Buffer.from(archiveData, "base64")), tmpOut);

    const extractDir = join(tmpDir, `extract-${Date.now()}`);
    await mkdir(extractDir, { recursive: true });

    if (ext === ".zip") {
      await execAsync(`unzip -o "${tmpFile}" -d "${extractDir}"`);
    } else {
      await execAsync(`tar xzf "${tmpFile}" -C "${extractDir}"`);
    }

    const foundDir = await findSkillMd(extractDir);
    if (!foundDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return res.status(400).json({ error: "No SKILL.md found in archive" });
    }

    const dirName = normalizeName(basename(foundDir));
    const targetBase = scope === "global"
      ? join(homedir(), ".claude", "skills")
      : join(projectPath, ".claude", "skills");
    const targetDir = join(targetBase, dirName);
    await mkdir(targetDir, { recursive: true });

    const entries = await readdir(foundDir);
    let filesCount = 0;
    for (const entry of entries) {
      const src = join(foundDir, entry);
      const entryStat = await stat(src);
      if (entryStat.isFile()) {
        const normalized = entry.toUpperCase() === "SKILL.MD" ? "SKILL.md" : entry;
        await copyFile(src, join(targetDir, normalized));
        filesCount++;
      }
    }

    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    res.json({ success: true, path: targetDir, filesCount, name: dirName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Uninstall ───────────────────────────────────────────

router.delete("/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const { scope, projectPath } = req.query;

    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      return res.status(400).json({ error: "Invalid skill name" });
    }

    const skillDir = scope === "global"
      ? join(homedir(), ".claude", "skills", name)
      : join(projectPath, ".claude", "skills", name);

    const hasSkill = existsSync(join(skillDir, "SKILL.md")) ||
                     existsSync(join(skillDir, "SKILL.md.disabled"));
    if (!hasSkill) {
      return res.status(404).json({ error: "Skill not found" });
    }

    await rm(skillDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Toggle ──────────────────────────────────────────────

router.put("/:name/toggle", async (req, res) => {
  try {
    const { name } = req.params;
    const { scope, projectPath } = req.query;

    const skillDir = scope === "global"
      ? join(homedir(), ".claude", "skills", name)
      : join(projectPath, ".claude", "skills", name);

    const enabledPath = join(skillDir, "SKILL.md");
    const disabledPath = join(skillDir, "SKILL.md.disabled");

    if (existsSync(enabledPath)) {
      await rename(enabledPath, disabledPath);
      res.json({ success: true, enabled: false });
    } else if (existsSync(disabledPath)) {
      await rename(disabledPath, enabledPath);
      res.json({ success: true, enabled: true });
    } else {
      res.status(404).json({ error: "Skill not found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { parseGithubUrl };
export default router;
