// agent-skills command line: list, add and remove skills and agents for supported tools.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { TOOLS, TOOL_IDS, SCOPES, detectTools, overlaps } from "../lib/tools.mjs";
import { findCatalog } from "../lib/catalog.mjs";
import { OK_STATUSES, PACKAGE_NAME } from "../lib/install.mjs";
import { agentOverlapNotes, installedItems, planAdd, planRemove, runAdd, runRemove } from "../lib/operations.mjs";
import * as prompts from "./prompt.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2 };

class UsageError extends Error {}

const HELP = `Usage: npx ${PACKAGE_NAME} <command> [options]

Commands:
  list                   Show every skill and agent available in this repository
  add [<name>...]        Install skills (folders) and agents (converted files) for tools
  remove [<name>...]     Remove skills and agents that agent-skills installed

Options:
  --tool <ids>           Comma-separated tools: ${TOOL_IDS.join(", ")}
  --scope <scope>        user (default, home folder) or project (current folder)
  --force                add: replace a skill folder or agent file that already exists (an agent
                         file agent-skills did not write is copied to <file>.bak first)
                         remove: also delete an agent file that was edited after installation
  --allow-broader-access add: install an agent for a tool that cannot restrict its tools the way the
                         source asks (Codex always), without that restriction. Never implied by --yes
  --yes, -y              Skip the confirmation summary
  --dry-run              Show what would change, change nothing
  --json                 Print a JSON result on stdout, messages on stderr
  --help, -h             Show this help
  --version, -v          Show the version

In a terminal, add and remove ask for any name, tool or scope not given.

Tools and folders (user scope | project scope):
${TOOL_IDS.map((id) => `  ${id.padEnd(8)} skills ~/${TOOLS[id].user} | ./${TOOLS[id].project}\n  ${"".padEnd(8)} agents ~/${TOOLS[id].agents.user} | ./${TOOLS[id].agents.project}`).join("\n")}
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
        tool: { type: "string" },
        scope: { type: "string" },
        force: { type: "boolean", default: false },
        "allow-broader-access": { type: "boolean", default: false },
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
  const [command, ...positionalNames] = positionals;
  const names = [...new Set(positionalNames)];
  const json = opts.json;
  const say = (line) => (json ? stderr : stdout).write(line + "\n");
  const ask = { input: stdin, output: stderr };

  if (opts.version) return stdout.write(version + "\n"), EXIT.OK;
  if (opts.help || !command) {
    (opts.help ? stdout : stderr).write(HELP);
    return opts.help ? EXIT.OK : EXIT.USAGE;
  }

  const catalog = findCatalog(root);
  const byName = new Map(catalog.map((i) => [i.name, i]));

  try {
    if (command === "list") {
      if (json) stdout.write(JSON.stringify(catalog.map(({ kind, name, plugin, description }) => ({ kind, name, plugin, description }))) + "\n");
      else if (!catalog.length) stdout.write("No skills or agents available yet.\n");
      else {
        const width = Math.max(...catalog.map((i) => i.name.length));
        for (const i of catalog) stdout.write(`${i.kind.padEnd(5)}  ${i.name.padEnd(width)}  ${i.plugin}  ${i.description}\n`);
        if (!catalog.some((i) => i.kind === "agent")) stdout.write("No agents available yet.\n");
      }
      return EXIT.OK;
    }
    if (command !== "add" && command !== "remove") throw new UsageError(`Unknown command "${command}". Run with --help for usage.`);

    const unknown = names.filter((n) => !byName.has(n));
    if (unknown.length)
      throw new UsageError(`Unknown name: ${unknown.join(", ")}. No skill or agent has that name. Run "agent-skills list" to see what is available.`);

    // Tools
    let tools = opts.tool ? [...new Set(opts.tool.split(",").map((a) => a.trim()).filter(Boolean))] : null;
    if (tools) {
      const bad = tools.filter((a) => !TOOLS[a]);
      if (bad.length) throw new UsageError(`Unknown tool: ${bad.join(", ")}. Supported tools: ${TOOL_IDS.join(", ")}.`);
    }
    if (opts.scope && !SCOPES.includes(opts.scope))
      throw new UsageError(`Unknown scope "${opts.scope}". Use "user" or "project".`);

    const detected = detectTools(env.home);
    const askTools = async () => {
      if (tools) return tools;
      if (!interactive)
        throw new UsageError(
          `Missing --tool. Detected tools: ${detected.join(", ") || "none"}. ` +
            `Example: --tool ${detected[0] ?? "claude"}. Supported: ${TOOL_IDS.join(", ")}.`,
        );
      return prompts.checkbox({
        ...ask,
        message: command === "add" ? "Install for which tools?" : "Remove from which tools?",
        choices: TOOL_IDS.map((id) => ({ value: id, label: TOOLS[id].label, hint: id, checked: detected.includes(id) })),
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
    /** @returns {Promise<object[]|null>} chosen catalog items, [] when none, null when cancelled */
    const askItems = async (choices, emptyMessage) => {
      if (names.length) return names.map((n) => byName.get(n));
      if (!interactive)
        throw new UsageError(
          `Missing skill or agent name. Available skills and agents: ${catalog.map((i) => i.name).join(", ") || "none"}.`,
        );
      if (!choices.length) return say(emptyMessage), [];
      const picked = await prompts.checkbox({
        ...ask,
        message: command === "add" ? "Which skills or agents do you want to install?" : "Which skills or agents do you want to remove?",
        choices: choices.map((i) => ({ value: i.name, label: `[${i.kind}] ${i.name}`, hint: i.description })),
      });
      return picked === null ? null : picked.map((n) => byName.get(n));
    };

    let items, scope;
    if (command === "add") {
      items = await askItems(catalog, "No skills or agents available yet.");
      if (items === null || !items.length) return cancelled(stderr, items);
      tools = await askTools();
      if (tools === null || !tools.length) return cancelled(stderr, tools);
      scope = await askScope();
      if (scope === null) return cancelled(stderr, null);
    } else {
      tools = await askTools();
      if (tools === null || !tools.length) return cancelled(stderr, tools);
      scope = await askScope();
      if (scope === null) return cancelled(stderr, null);
      const installed = installedItems(catalog, tools, scope, env);
      items = await askItems(installed, `No skills or agents installed by agent-skills for ${tools.join(", ")} at ${scope} scope.`);
      if (items === null) return cancelled(stderr, null);
      if (!items.length) {
        if (installed.length) return cancelled(stderr, []);
        if (json) stdout.write(JSON.stringify({ ok: true, results: [], notes: [] }) + "\n");
        return EXIT.OK;
      }
    }

    const dryRun = opts["dry-run"];
    const plan =
      command === "add"
        ? planAdd({ items, tools, scope, env, catalog, version, allowBroader: opts["allow-broader-access"], force: opts.force })
        : planRemove({ items, tools, scope, env });

    if (interactive && !opts.yes && !dryRun) {
      const verb = command === "add" ? "Install" : "Remove";
      stderr.write(`\n${verb} ${items.length} item(s) for ${tools.join(", ")} at ${scope} scope:\n`);
      for (const e of plan) {
        if (e.refused) stderr.write(`  refused  ${e.path}  (${e.refused})\n`);
        else stderr.write(`  ${e.kind.padEnd(5)}  ${e.path}${e.dependency ? `  (skill needed by ${e.requiredBy.join(", ")})` : ""}\n`);
      }
      const broader = plan.filter((e) => e.conversion?.broadened);
      if (broader.length) {
        stderr.write("\nBroader access than the source asks (--allow-broader-access):\n");
        for (const e of broader) stderr.write(`  ${e.name} for ${e.tools[0]}: ${e.conversion.broader}\n`);
        stderr.write("\n");
      }
      const ok = await prompts.confirm({ ...ask, message: "Continue?" });
      if (!ok) return cancelled(stderr, null);
    }

    const results =
      command === "add" ? runAdd(plan, { force: opts.force, dryRun, version }) : runRemove(plan, { force: opts.force, dryRun });
    const ok = results.every((r) => OK_STATUSES.has(r.status));

    const notes = [];
    if (command === "add") {
      const wrote = (kind) => results.some((r) => r.kind === kind && OK_STATUSES.has(r.status));
      if (wrote("skill")) {
        for (const o of overlaps(tools, scope))
          notes.push(`${TOOLS[o.reader].label} also reads ${o.path}, so it may list skills installed for ${o.other} twice.`);
        for (const a of tools) if (TOOLS[a].note) notes.push(TOOLS[a].note);
      }
      if (wrote("agent")) notes.push(...agentOverlapNotes(results, tools, scope));
    }

    if (json) {
      stdout.write(JSON.stringify({ ok, results: results.map(({ restricted, ...rest }) => rest), notes }) + "\n");
    } else {
      for (const r of results) {
        stdout.write(`${r.status.padEnd(13)} ${r.path}${r.message ? `  (${r.message})` : ""}\n`);
        const pad = " ".repeat(14);
        if (r.dropped) stdout.write(`${pad}dropped for ${r.tools[0]}: ${r.dropped.join(", ")}\n`);
        if (r.broader) stdout.write(`${pad}broader access: ${r.broader}\n`);
        for (const n of r.notes ?? []) stdout.write(`${pad}note: ${n}\n`);
      }
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
