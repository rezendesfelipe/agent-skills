// Roadmap rules: acyclic dependencies, wave order, every Medium-or-above finding addressed or dispositioned,
// Critical findings in wave 1 (or a reason), wave totals and the capacity warning.
import { effortDays } from "./classify.mjs";

export const WAVES = {
  1: { days: "0-30" },
  2: { days: "31-60" },
  3: { days: "61-90" },
  4: { days: "later" },
};

/** @returns {string[][]} each cycle as a list of action IDs, first ID repeated at the end */
export function findCycles(actions) {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const cycles = [];
  const state = new Map(); // 1 = on the stack, 2 = done
  const stack = [];
  const seen = new Set();
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      if (state.get(dep) === 1) {
        const cycle = [...stack.slice(stack.indexOf(dep)), dep];
        const key = [...cycle.slice(0, -1)].sort().join(",");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (!state.has(dep)) visit(dep);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const a of actions) if (!state.has(a.id)) visit(a.id);
  return cycles;
}

/** Person-day range of the actions of one wave. `max` is null when an action is open-ended. */
export function waveTotals(actions, scale) {
  const days = effortDays(scale);
  const totals = {};
  for (const w of [1, 2, 3, 4]) {
    let min = 0;
    let max = 0;
    let n = 0;
    for (const a of actions.filter((x) => x.wave === w)) {
      n++;
      const [lo, hi] = days[a.effort] ?? [0, null];
      min += lo;
      max = max === null || hi === null ? null : max + hi;
    }
    totals[w] = { actions: n, min, max };
  }
  return totals;
}

/**
 * @returns {{errors: {code: string, message: string, where: string}[], warnings: {code: string, message: string}[], totals: object}}
 * Every error is roadmap-level: the roadmap step can fix it.
 */
export function checkRoadmap(assessment) {
  const actions = assessment.actions ?? [];
  const findings = assessment.findings ?? [];
  const errors = [];
  const warnings = [];
  const byId = new Map(actions.map((a) => [a.id, a]));

  for (const cycle of findCycles(actions))
    errors.push({ code: "cycle", where: "actions", message: `dependency cycle: ${cycle.join(" -> ")}` });

  actions.forEach((a, i) => {
    for (const dep of a.dependsOn ?? []) {
      const d = byId.get(dep);
      if (d && a.wave < d.wave)
        errors.push({ code: "wave-order", where: `actions[${i}]`, message: `${a.id} is in wave ${a.wave} but depends on ${d.id} in wave ${d.wave}` });
    }
  });

  const addressedBy = (fid) => actions.filter((a) => (a.addresses ?? []).includes(fid));
  for (const [i, f] of findings.entries()) {
    const acts = addressedBy(f.id);
    if (["Medium", "High", "Critical"].includes(f.severity) && !acts.length && !f.disposition)
      errors.push({
        code: "unaddressed",
        where: `findings[${i}]`,
        message: `${f.id} (${f.severity}) is addressed by no action and has no disposition (accepted or deferred, with a reason and an owner)`,
      });
    if (f.severity === "Critical" && acts.length && !acts.some((a) => a.wave === 1) && !acts.some((a) => a.reason?.trim()))
      errors.push({
        code: "critical-late",
        where: `findings[${i}]`,
        message: `${f.id} is Critical and addressed only after wave 1 (${acts.map((a) => `${a.id} in wave ${a.wave}`).join(", ")}) without a recorded reason`,
      });
  }

  const totals = waveTotals(actions, assessment.scope?.scale);
  for (const [w, cap] of Object.entries(assessment.scope?.capacity ?? {})) {
    const t = totals[w];
    if (!t) continue;
    if (t.min > cap) warnings.push({ code: "capacity", message: `wave ${w} needs at least ${t.min} person-days and the stated capacity is ${cap}` });
    else if (t.max === null || t.max > cap)
      warnings.push({ code: "capacity", message: `wave ${w} may exceed the stated capacity of ${cap} person-days (estimate ${t.min}-${t.max ?? "open"})` });
  }
  return { errors, warnings, totals };
}
