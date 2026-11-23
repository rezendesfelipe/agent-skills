// Where each supported tool reads Agent Skills and custom agents from.
// User-scope paths are relative to the home directory, project-scope paths to the
// current working directory. Skills checked against each vendor's docs on 2026-11-19,
// agents on 2026-11-23 (see openspec/changes/add-custom-agents/design.md).
import { existsSync } from "node:fs";
import { join } from "node:path";

export const TOOLS = {
  claude: {
    label: "Claude Code",
    user: ".claude/skills",
    project: ".claude/skills",
    detect: [".claude"],
    source: "https://docs.claude.com/en/docs/claude-code/skills",
    agents: {
      user: ".claude/agents",
      project: ".claude/agents",
      ext: ".md",
      source: "https://code.claude.com/docs/en/sub-agents",
    },
  },
  codex: {
    label: "OpenAI Codex",
    user: ".agents/skills",
    project: ".agents/skills",
    detect: [".codex", ".agents"],
    source: "https://developers.openai.com/codex/skills",
    agents: {
      user: ".codex/agents",
      project: ".codex/agents",
      ext: ".toml",
      source: "https://learn.chatgpt.com/docs/agent-configuration/subagents",
    },
  },
  gemini: {
    label: "Gemini CLI",
    user: ".gemini/skills",
    project: ".gemini/skills",
    detect: [".gemini"],
    alsoReads: [".agents/skills"],
    note: "Gemini CLI may need Agent Skills enabled in its settings: https://geminicli.com/docs/cli/skills/",
    source: "https://geminicli.com/docs/cli/skills/",
    agents: {
      user: ".gemini/agents",
      project: ".gemini/agents",
      ext: ".md",
      source: "https://geminicli.com/docs/core/subagents/",
    },
  },
  cursor: {
    label: "Cursor",
    user: ".cursor/skills",
    project: ".cursor/skills",
    detect: [".cursor"],
    alsoReads: [".claude/skills", ".codex/skills"],
    source: "https://cursor.com/docs/skills",
    agents: {
      user: ".cursor/agents",
      project: ".cursor/agents",
      ext: ".md",
      alsoReads: [".claude/agents", ".codex/agents"],
      source: "https://cursor.com/docs/subagents",
    },
  },
  copilot: {
    label: "GitHub Copilot",
    user: ".copilot/skills",
    project: ".github/skills",
    detect: [".copilot"],
    alsoReads: [".claude/skills", ".agents/skills"],
    source: "https://docs.github.com/en/copilot/concepts/agents/about-agent-skills",
    agents: {
      user: ".copilot/agents",
      project: ".github/agents",
      ext: ".agent.md",
      source: "https://docs.github.com/en/copilot/reference/custom-agents-configuration",
    },
  },
};

export const TOOL_IDS = Object.keys(TOOLS);
export const SCOPES = ["user", "project"];

/** Absolute skills folder for an tool and scope. */
export function skillsDir(tool, scope, { home, cwd }) {
  const a = TOOLS[tool];
  return scope === "project" ? join(cwd, a.project) : join(home, a.user);
}

/** Tools whose user configuration folder exists in `home`. */
export function detectTools(home) {
  return TOOL_IDS.filter((id) => TOOLS[id].detect.some((d) => existsSync(join(home, d))));
}

/**
 * Pairs of selected tools where one also reads the other's folder, so a skill
 * installed for both may be listed twice by the first.
 */
export function overlaps(tools, scope) {
  const out = [];
  for (const reader of tools) {
    for (const other of tools) {
      if (reader === other) continue;
      const otherPath = TOOLS[other][scope];
      if ((TOOLS[reader].alsoReads ?? []).includes(otherPath)) out.push({ reader, other, path: otherPath });
    }
  }
  return out;
}

/** Absolute agents folder for a tool and scope. */
export function agentsDir(tool, scope, { home, cwd }) {
  const a = TOOLS[tool].agents;
  return scope === "project" ? join(cwd, a.project) : join(home, a.user);
}

/**
 * Pairs of selected tools where one also reads the other's agents folder. The folders are the
 * same at both scopes, and `path` is shown the way users know it (`~/.claude/agents` at user scope).
 */
export function agentOverlaps(tools, scope) {
  const out = [];
  for (const reader of tools) {
    for (const other of tools) {
      if (reader === other) continue;
      const otherPath = TOOLS[other].agents[scope];
      if ((TOOLS[reader].agents.alsoReads ?? []).includes(otherPath))
        out.push({ reader, other, path: scope === "user" ? `~/${otherPath}` : otherPath });
    }
  }
  return out;
}
