// The workflow graph, enforced by code. No LangGraph and no runtime dependency: nodes, allowed transitions,
// the command that runs each node, and the gates (content hashes) live here, and the state is a file.
//
// Node types: C = fixed code, M = one bounded model call, A = bounded agent loop with read-only tools,
// H = human interrupt.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { outPaths, hashAll, hashChecked, hashCore } from "./assessment.mjs";
import { readJson, writeJson } from "./util.mjs";

export const NODES = {
  scope: { type: "H+M", does: "ask the user for scope, questions, author, version, date, language and frameworks" },
  inventory: { type: "C", does: "list files, hashes and the revision", command: "inventory" },
  investigate: { type: "A", does: "read-only exploration; draft evidence and findings in assessment.json" },
  verify: { type: "C", does: "check every citation", command: "verify" },
  repair: { type: "M", does: "fix a citation or add evidence, then verify again" },
  demote: { type: "C", does: "after two repairs, unsupported findings move to Not verified (done inside verify)" },
  classify: { type: "M+C", does: "model proposes impact, likelihood and effort; code computes severity", command: "classify" },
  roadmap: { type: "M", does: "write actions, waves and dependencies in assessment.json" },
  "roadmap-check": { type: "C", does: "acyclic, wave order, coverage (done inside check)" },
  consistency: { type: "C", does: "IDs, references, frameworks, secrets, tokens (done inside check)" },
  narrate: { type: "M", does: "write summary (with {{count.*}} tokens) and decisions" },
  review: { type: "H", does: "the user reviews Critical and High findings, Not verified and the summary", command: "review" },
  render: { type: "C", does: "write Markdown, annexes and JSON", command: "render" },
  delegate: { type: "handoff", does: "hand report/report.md to the docs-generator skill" },
  finish: { type: "C+M", does: "paths, run metadata, what was not verified", command: "finish" },
};

/** Allowed edges. `current` in run.json is always one of the keys that can be waited at. */
export const NEXT = {
  scope: ["inventory"],
  inventory: ["investigate"],
  investigate: ["verify"],
  verify: ["classify", "repair"],
  repair: ["verify"],
  demote: ["classify"],
  classify: ["roadmap"],
  roadmap: ["roadmap-check"],
  "roadmap-check": ["consistency", "roadmap"],
  consistency: ["narrate", "repair", "roadmap"],
  narrate: ["review"],
  review: ["render", "verify"],
  render: ["delegate"],
  delegate: ["finish"],
  finish: [],
};

const AFTER_INVENTORY = ["investigate", "verify", "repair", "classify", "roadmap", "narrate", "review", "render", "delegate", "finish"];
const AFTER_CLASSIFY = ["classify", "roadmap", "narrate", "review", "render", "delegate", "finish"];

/** Where each command may run. */
export const COMMAND_NODES = {
  inventory: ["inventory", "investigate"],
  verify: AFTER_INVENTORY,
  classify: AFTER_CLASSIFY,
  check: ["roadmap", "narrate", "review"],
  review: ["narrate", "review"],
  render: ["narrate", "review", "render", "delegate"],
  finish: ["delegate", "render"],
};

/** What to do at a node, for messages: [what, command]. */
const DO_AT = {
  inventory: "run `inventory`",
  investigate: "write evidence and findings in assessment.json, then run `verify`",
  verify: "run `verify`",
  repair: "fix the failing citations (or ask the user for the missing file), then run `verify`",
  classify: "run `classify`",
  roadmap: "write the actions in assessment.json, then run `check`",
  narrate: "write the summary and decisions in assessment.json, then run `review`",
  review: "show the review packet to the user; after an explicit yes run `review --approve --by <name>`",
  render: "run `render`",
  delegate: "hand report/report.md to the docs-generator skill, then run `finish`",
  finish: "the flow is complete",
};

export const nodeToRunFirst = (node) => DO_AT[node] ?? `go to ${node}`;

export function newState() {
  return {
    schemaVersion: "1.0",
    current: "inventory",
    repairAttempts: 0,
    roadmapAttempts: 0,
    verifiedHash: null,
    checkedHash: null,
    reviewedHash: null,
    reviewer: null,
    unreviewed: false,
    catalogs: {},
    events: [],
  };
}

export function loadState(out) {
  const p = outPaths(out).state;
  return existsSync(p) ? readJson(p) : null;
}

export function saveState(out, state) {
  const p = outPaths(out).state;
  mkdirSync(dirname(p), { recursive: true });
  state.events = state.events.slice(-200);
  writeJson(p, state);
}

export function logEvent(state, command, ok, note) {
  state.events.push({ command, node: state.current, ok, ...(note ? { note } : {}) });
}

/** The nodes that may run after the current one, with the command for each. */
export function allowedNext(state) {
  const cur = state.current;
  const next = NEXT[cur] ?? [];
  return next.map((n) => ({ node: n, command: NODES[n]?.command ?? null, does: NODES[n]?.does }));
}

/**
 * Is `command` allowed at the current node? @returns {null | {message: string, firstNode: string}}
 */
export function checkOrder(state, command) {
  const nodes = COMMAND_NODES[command];
  if (!nodes || nodes.includes(state.current)) return null;
  const message = `${command} cannot run at node "${state.current}". At that node: ${nodeToRunFirst(state.current)}.`;
  return { message, firstNode: state.current };
}

/** Gates by content hash. @returns {null | {message: string, returnTo: string}} */
export function checkGate(state, assessment, command, { unreviewed = false } = {}) {
  if (["classify", "check", "render"].includes(command) && state.verifiedHash !== hashCore(assessment))
    return {
      message: `${command} is refused: the evidence or the findings changed since the last successful verify (or verify never succeeded). Run verify first.`,
      returnTo: "verify",
    };
  if (["review-approve", "render"].includes(command) && state.checkedHash !== hashChecked(assessment))
    return {
      message: `${command} is refused: the assessment changed since the last successful check (or check never succeeded). Run check first.`,
      returnTo: "roadmap",
    };
  if (command === "render" && !unreviewed && state.reviewedHash !== hashAll(assessment))
    return {
      message: "render is refused: the assessment was not approved after its last change. Run review (and, after the user's explicit yes, review --approve --by <name>), or use --unreviewed to stamp the report as not human-reviewed.",
      returnTo: "review",
    };
  return null;
}

export function readText(p) {
  return readFileSync(p, "utf8");
}
