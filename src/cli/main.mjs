// agent-skills command line: list, add and remove skills for supported agents.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AGENTS, AGENT_IDS, SCOPES, detectAgents, overlaps } from "../lib/agents.mjs";
import { findSkills } from "../lib/catalog.mjs";
import { OK_STATUSES, PACKAGE_NAME, install, installedSkills, planTargets, remove } from "../lib/install.mjs";
import * as prompts from "./prompt.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2 };

class UsageError extends Error {}

const HELP = `Usage: npx ${PACKAGE_NAME} <command> [options]

Commands:
  list                   Show every skill available in this repository
  add [<skill>...]       Install skills into agents' skills folders
  remove [<skill>...]    Remove skills that agent-skills installed

Options:
  --agent <ids>          Comma-separated agents: ${AGENT_IDS.join(", ")}
  --scope <scope>        user (default, home folder) or project (current folder)
  --force                add: replace a skill folder that already exists
  --yes, -y              Skip the confirmation summary
  --dry-run              Show what would change, change nothing
  --json                 Print a JSON result on stdout, messages on stderr
  --help, -h             Show this help
  --version, -v          Show the version

In a terminal, add and remove ask for any skill, agent or scope not given.

Agents and folders (user scope | project scope):
${AGENT_IDS.map((id) => `  ${id.padEnd(8)} ~/${AGENTS[id].user} | ./${AGENTS[id].project}`).join("\n")}
`;

/**
 * @param {string[]} argv arguments after the program name
 * @param {object} [io] injectable streams and environment (tests)
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const stdin = io.stdin ?? process.stdin;
  const env = { home: io.home ?? homedir(), cwd: io.cwd ?? process.cwd() };
  const root = io.root ?? process.env.AGENT_SKILLS_ROOT ?? PACKAGE_ROOT;
  const interactive = io.interactive ?? Boolean(stdin.isTTY && stderr.isTTY);
  const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        agent: { type: "string" },
        scope: { type: "string" },
        force: { type: "boolean", default: false },
        yes: { type: "boolean", short: "y", default: false },
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (e) {
    stderr.write(`${e.message}\nRun with --help for usage.\n`);
    return EXIT.USAGE;
  }
  const { values: opts, positionals } = args;
  const [command, ...names] = positionals;
  const json = opts.json;
  const say = (line) => (json ? stderr : stdout).write(line + "\n");
  const ask = { input: stdin, output: stderr };

  if (opts.version) return stdout.write(version + "\n"), EXIT.OK;
  if (opts.help || !command) {
    (opts.help ? stdout : stderr).write(HELP);
    return opts.help ? EXIT.OK : EXIT.USAGE;
  }

  const catalog = findSkills(root);
  const byName = new Map(catalog.map((s) => [s.name, s]));

  try {
    if (command === "list") {
      if (json) stdout.write(JSON.stringify(catalog.map(({ name, plugin, description }) => ({ name, plugin, description }))) + "\n");
      else if (!catalog.length) stdout.write("No skills available yet.\n");
      else {
        const width = Math.max(...catalog.map((s) => s.name.length));
        for (const s of catalog) stdout.write(`${s.name.padEnd(width)}  ${s.plugin}  ${s.description}\n`);
      }
      return EXIT.OK;
    }
    if (command !== "add" && command !== "remove") throw new UsageError(`Unknown command "${command}". Run with --help for usage.`);

    const unknown = names.filter((n) => !byName.has(n));
    if (unknown.length)
      throw new UsageError(`Unknown skill: ${unknown.join(", ")}. Run "agent-skills list" to see the available skills.`);

    // Agents
    let agents = opts.agent ? [...new Set(opts.agent.split(",").map((a) => a.trim()).filter(Boolean))] : null;
    if (agents) {
      const bad = agents.filter((a) => !AGENTS[a]);
      if (bad.length) throw new UsageError(`Unknown agent: ${bad.join(", ")}. Supported agents: ${AGENT_IDS.join(", ")}.`);
    }
    if (opts.scope && !SCOPES.includes(opts.scope))
      throw new UsageError(`Unknown scope "${opts.scope}". Use "user" or "project".`);

    const detected = detectAgents(env.home);
    const askAgents = async () => {
      if (agents) return agents;
      if (!interactive)
        throw new UsageError(
          `Missing --agent. Detected agents: ${detected.join(", ") || "none"}. ` +
            `Example: --agent ${detected[0] ?? "claude"}. Supported: ${AGENT_IDS.join(", ")}.`,
        );
      return prompts.checkbox({
        ...ask,
        message: command === "add" ? "Install for which agents?" : "Remove from which agents?",
        choices: AGENT_IDS.map((id) => ({ value: id, label: AGENTS[id].label, hint: id, checked: detected.includes(id) })),
      });
    };
    const askScope = async () => {
      if (opts.scope) return opts.scope;
      if (!interactive) return "user";
      return prompts.select({
        ...ask,
        message: "Scope?",
        initial: "user",
        choices: [
          { value: "user", label: "user", hint: "your home folder, all projects" },
          { value: "project", label: "project", hint: `this folder (${env.cwd})` },
        ],
      });
    };
    const askSkills = async (choices, emptyMessage) => {
      if (names.length) return names;
      if (!interactive)
        throw new UsageError(
          `Missing skill name. Available skills: ${catalog.map((s) => s.name).join(", ") || "none"}.`,
        );
      if (!choices.length) return say(emptyMessage), [];
      return prompts.checkbox({
        ...ask,
        message: command === "add" ? "Which skills do you want to install?" : "Which skills do you want to remove?",
        choices: choices.map((s) => ({ value: s.name, label: s.name, hint: s.description })),
      });
    };

    let skills, scope;
    if (command === "add") {
      skills = await askSkills(catalog, "No skills available yet.");
      if (skills === null || !skills.length) return cancelled(stderr, skills);
      agents = await askAgents();
      if (agents === null || !agents.length) return cancelled(stderr, agents);
      scope = await askScope();
      if (scope === null) return cancelled(stderr, null);
    } else {
      agents = await askAgents();
      if (agents === null || !agents.length) return cancelled(stderr, agents);
      scope = await askScope();
      if (scope === null) return cancelled(stderr, null);
      const installed = installedSkills(catalog, agents, scope, env);
      skills = await askSkills(installed, `No skills installed by agent-skills for ${agents.join(", ")} at ${scope} scope.`);
      if (skills === null) return cancelled(stderr, null);
      if (!skills.length) {
        if (installed.length) return cancelled(stderr, []);
        if (json) stdout.write(JSON.stringify({ ok: true, results: [], notes: [] }) + "\n");
        return EXIT.OK;
      }
    }

    const targets = planTargets(skills.map((n) => byName.get(n)), agents, scope, env);
    const dryRun = opts["dry-run"];

    if (interactive && !opts.yes && !dryRun) {
      const verb = command === "add" ? "Install" : "Remove";
      stderr.write(`\n${verb} ${skills.length} skill(s) for ${agents.join(", ")} at ${scope} scope:\n`);
      for (const t of targets) stderr.write(`  ${t.path}\n`);
      const ok = await prompts.confirm({ ...ask, message: "Continue?" });
      if (!ok) return cancelled(stderr, null);
    }

    const results = targets.map((t) => {
      const r = command === "add" ? install(t, { force: opts.force, dryRun, version }) : remove(t, { dryRun });
      return { skill: t.skill.name, agents: t.agents, path: t.path, ...r };
    });
    const ok = results.every((r) => OK_STATUSES.has(r.status));

    const notes = [];
    if (command === "add" && results.some((r) => OK_STATUSES.has(r.status))) {
      for (const o of overlaps(agents, scope))
        notes.push(`${AGENTS[o.reader].label} also reads ${o.path}, so it may list skills installed for ${o.other} twice.`);
      for (const a of agents) if (AGENTS[a].note) notes.push(AGENTS[a].note);
    }

    if (json) stdout.write(JSON.stringify({ ok, results, notes }) + "\n");
    else {
      for (const r of results) stdout.write(`${r.status.padEnd(13)} ${r.path}${r.message ? `  (${r.message})` : ""}\n`);
    }
    for (const n of notes) say(`note: ${n}`);
    return ok ? EXIT.OK : EXIT.FAILED;
  } catch (e) {
    if (e instanceof UsageError) {
      if (json) stdout.write(JSON.stringify({ ok: false, error: e.message }) + "\n");
      stderr.write(e.message + "\n");
      return EXIT.USAGE;
    }
    throw e;
  }
}

function cancelled(stderr, value) {
  stderr.write(value === null ? "Cancelled.\n" : "Nothing selected. Cancelled.\n");
  return EXIT.FAILED;
}

