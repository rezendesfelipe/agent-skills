// Where each supported agent reads Agent Skills from.
// User-scope paths are relative to the home directory, project-scope paths to the
// current working directory. Checked against each vendor's docs on 2026-11-19.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const AGENTS = {
  claude: {
    label: "Claude Code",
    user: ".claude/skills",
    project: ".claude/skills",
    detect: [".claude"],
    source: "https://docs.claude.com/en/docs/claude-code/skills",
  },
  codex: {
    label: "OpenAI Codex",
    user: ".agents/skills",
    project: ".agents/skills",
    detect: [".codex", ".agents"],
    source: "https://developers.openai.com/codex/skills",
  },
  gemini: {
    label: "Gemini CLI",
    user: ".gemini/skills",
    project: ".gemini/skills",
    detect: [".gemini"],
    alsoReads: [".agents/skills"],
    note: "Gemini CLI may need Agent Skills enabled in its settings: https://geminicli.com/docs/cli/skills/",
    source: "https://geminicli.com/docs/cli/skills/",
  },
  cursor: {
    label: "Cursor",
    user: ".cursor/skills",
    project: ".cursor/skills",
    detect: [".cursor"],
    alsoReads: [".claude/skills", ".codex/skills"],
    source: "https://cursor.com/docs/skills",
  },
  copilot: {
    label: "GitHub Copilot",
    user: ".copilot/skills",
    project: ".github/skills",
    detect: [".copilot"],
    alsoReads: [".claude/skills", ".agents/skills"],
    source: "https://docs.github.com/en/copilot/concepts/agents/about-agent-skills",
  },
};

export const AGENT_IDS = Object.keys(AGENTS);
export const SCOPES = ["user", "project"];

/** Absolute skills folder for an agent and scope. */
export function skillsDir(agent, scope, { home, cwd }) {
  const a = AGENTS[agent];
  return scope === "project" ? join(cwd, a.project) : join(home, a.user);
}

/** Agents whose user configuration folder exists in `home`. */
export function detectAgents(home) {
  return AGENT_IDS.filter((id) => AGENTS[id].detect.some((d) => existsSync(join(home, d))));
}

/**
 * Pairs of selected agents where one also reads the other's folder, so a skill
 * installed for both may be listed twice by the first.
 */
export function overlaps(agents, scope) {
  const out = [];
  for (const reader of agents) {
    for (const other of agents) {
      if (reader === other) continue;
      const otherPath = AGENTS[other][scope];
      if ((AGENTS[reader].alsoReads ?? []).includes(otherPath)) out.push({ reader, other, path: otherPath });
    }
  }
  return out;
}
