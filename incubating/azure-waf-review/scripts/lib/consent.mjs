// `waf.mjs consent`: the consent produced by the USER in their own terminal, outside the agent (design Decision 8, D2; specs "Consent by
// the user", "Consent argument vectors and screen", "Staged exposure and production gate", "Dedicated identity").
// It does the first Azure read, shows a sanitized screen, compares the typed subscription count with the count read and with an
// independent list, judges the identity (only Reader and Security Reader), and writes consent.json with the hash of the exact text shown.
// consent.json is TAMPER-EVIDENT, not tamper-proof: it holds a hash and fields from which the text can be derived again, so an edit of one
// field is seen, but whoever can rewrite the whole file consistently can forge it; the manifest seals its hash after `collect`, and the
// guard of PR 4 keeps the model from writing it. Residual risk when the hook is inactive.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { isAllowedAzVector } from "./azread.mjs";
import { loadCatalog } from "./catalog.mjs";
import { kqlProblems } from "./kql.mjs";
import { classifyAzPath, isolatedProfileProblem, runBaseProblem } from "./platform.mjs";
import { GUID_RE, UsageError, canonicalSha, checkRunId, sha256, writeFileAtomic, writeJsonFile } from "./util.mjs";

export const STAGES = ["nonprod", "one-prod", "root-mg"];
export const PREVIOUS_STAGE = { "one-prod": "nonprod", "root-mg": "one-prod" };
export const DEFAULT_QUERY_BUDGET = 6000;
export const PHRASES = {
  yes: "yes",
  retention: "RETENTION CHECKED",
  acceptance: "ACCEPTANCE RECORDED",
  previous: "PREVIOUS STAGE REVIEWED",
  skip: "SKIP PREVIOUS STAGES",
  unverifiable: "I ACCEPT AN UNVERIFIED IDENTITY",
  unclassified: "I ACCEPT UNCLASSIFIED ROLES",
  folder: "I ACCEPT THIS OUTPUT FOLDER",
};
const TOP_KEYS = new Set(["schema", "runId", "createdAt", "stage", "redact", "queryBudget", "expectedSubs", "readSubs", "tenant", "identity", "az", "profile", "outputFolder", "scope", "accounts", "independent", "acks", "mcp", "textSha256", "storedText", "storedTextSha256"]);

// ---------------------------------------------------------------------------------------------------------------- screen safety
const CTRL = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
/** Every string the screen shows comes from whoever administers the tenant: control, ESC and bidi characters are SHOWN as text (\u001b), never emitted. */
export function screenSafe(s, cap = 120) {
  let t = String(s ?? "");
  if (t.length > cap) t = `${t.slice(0, cap)}...`;
  return t.replace(CTRL, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

// ---------------------------------------------------------------------------------------------------------------- arguments
/** The typed count: plain ASCII digits, no sign, no space, no leading zero, at most four digits. Nothing is trimmed. */
export function parseExpectedSubs(s) {
  if (typeof s !== "string" || !/^[1-9][0-9]{0,3}$/.test(s)) throw new UsageError(`--expected-subs must be the number of subscriptions you expect, in plain digits (1 to 9999), not ${JSON.stringify(String(s).slice(0, 20))}`);
  return Number(s);
}
export function parseBudget(s) {
  if (s === undefined) return DEFAULT_QUERY_BUDGET;
  if (typeof s !== "string" || !/^[1-9][0-9]{0,5}$/.test(s) || Number(s) > 100000) throw new UsageError("--query-budget must be plain digits from 1 to 100000");
  return Number(s);
}
const parseGuidList = (s) => {
  const ids = String(s).split(",");
  if (!ids.length || ids.some((x) => !GUID_RE.test(x))) throw new UsageError("--subscriptions must be a comma-separated list of subscription GUIDs with no spaces");
  const low = ids.map((x) => x.toLowerCase());
  if (new Set(low).size !== low.length) throw new UsageError("--subscriptions repeats a subscription");
  return low;
};
const MG_RE = /^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$/;

/** @returns {{stage:string, expected:number, budget:number, redact:string, subs:string[]|null, mg:string|null}} or throws UsageError */
export function parseConsentArgs(a) {
  checkRunId(a.runId, "--run-id");
  if (!STAGES.includes(a.stage)) throw new UsageError(`--stage must be one of ${STAGES.join(", ")}`);
  const expected = parseExpectedSubs(a.expectedSubs);
  const budget = parseBudget(a.queryBudget);
  const redact = a.redact ?? "default";
  if (!["default", "strict"].includes(redact)) throw new UsageError("--redact is default or strict (there is no way to turn redaction off)");
  const subs = a.subscriptions === undefined ? null : parseGuidList(a.subscriptions);
  const mg = a.managementGroup === undefined ? null : a.managementGroup;
  if (mg !== null && !MG_RE.test(mg)) throw new UsageError("--management-group must be a management group id (letters, digits, dot, dash, underscore, parentheses)");
  if (a.stage === "root-mg") {
    if (!mg) throw new UsageError("--stage root-mg needs --management-group <id>");
    if (subs) throw new UsageError("--stage root-mg takes the whole management group: do not pass --subscriptions");
  } else {
    if (mg) throw new UsageError(`--stage ${a.stage} takes a list of subscriptions, not --management-group`);
    if (!subs) throw new UsageError(`--stage ${a.stage} needs --subscriptions <guid,guid,...>`);
    if (a.stage === "one-prod" && subs.length !== 1) throw new UsageError("--stage one-prod is exactly one production subscription");
  }
  return { stage: a.stage, expected, budget, redact, subs, mg };
}

// ---------------------------------------------------------------------------------------------------------------- roles
/** Splits role assignment rows into read-only, write-capable and unclassified, by role definition GUID (the table is in catalog/consent.json). */
let CONSENT_CATALOG = null;
/** The consent part of the shipped catalog (queries and role table), loaded and validated once. */
export const consentCatalog = () => (CONSENT_CATALOG ??= loadCatalog().consent);
export function classifyRoleAssignments(rows, table = consentCatalog().roles) {
  const out = { read: [], write: [], other: [] };
  const seen = new Set();
  for (const r of rows ?? []) {
    const last = String(r?.roleDefinitionId ?? "").split("/").pop().toLowerCase();
    const guid = GUID_RE.test(last) ? last : "";
    const scope = screenSafe(r?.scope ?? "", 160);
    const key = `${guid}|${scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (guid && table.write[guid]) out.write.push({ guid, name: table.write[guid], scope });
    else if (guid && table.read[guid]) out.read.push({ guid, name: table.read[guid], scope });
    else out.other.push({ guid: guid || "(unreadable role id)", name: null, scope });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the text
const need = (c) => ({
  retention: c.stage !== "nonprod",
  acceptance: c.stage !== "nonprod",
  previousStage: c.stage !== "nonprod",
  identityUnverifiable: !c.identity.principalVerified || c.identity.roles.length === 0,
  unclassifiedRoles: (c.identity.unclassified ?? []).length > 0,
  outputFolder: Boolean(c.outputFolder.problem),
});
const yn = (b) => (b ? "yes" : "no");

/**
 * The screen, built ONLY from the fields of consent.json and a name lookup, so it can be derived again from the file.
 * `names` maps subscription id to a display name already passed through screenSafe, or is empty (the stored text of the strict mode).
 */
export function buildConsentText(c, names = new Map()) {
  const nm = (id) => (names.has(id) ? JSON.stringify(names.get(id)) : "[name not stored]");
  const L = [];
  L.push("WAF REVIEW CONSENT");
  L.push("A read-only review of an Azure tenant. Read all of this before you answer. Nothing is changed in the tenant.");
  L.push(`Run id: ${c.runId}`);
  L.push(`Time (UTC): ${c.createdAt}`);
  L.push(`Tenant: ...${c.tenant.last4} (last four characters)`);
  L.push(`Identity: ${c.identity.type}; principal id verified: ${yn(c.identity.principalVerified)}`);
  L.push(`Roles found: ${c.identity.roles.length ? c.identity.roles.map((r) => `${r.name ?? r.guid} at ${r.scope}`).join("; ") : "none visible"}`);
  if ((c.identity.unclassified ?? []).length) L.push(`Roles NOT on the read-only list (Reader, Security Reader): ${c.identity.unclassified.join(", ")}`);
  L.push(`az: ${c.az.path} (native launcher, not a Windows executable); ${c.az.version}`);
  L.push(`Azure CLI profile: isolated at ${c.profile.dir}`);
  L.push(`Output folder: ${c.outputFolder.path}${c.outputFolder.problem ? ` (PROBLEM: ${c.outputFolder.problem})` : ""}`);
  L.push(`Stage: ${c.stage}${c.scope.managementGroup ? `; management group ${c.scope.managementGroup}` : ""}`);
  L.push(`Subscriptions typed (expected): ${c.expectedSubs}; read: ${c.readSubs}`);
  for (const a of c.accounts) L.push(`  - ${a.id} ${nm(a.id)} state ${a.state}${c.scope.subscriptions.includes(a.id) ? ", readable" : ", NOT covered"}`);
  for (const n of c.scope.notCovered) L.push(`Not covered: ${n.id} (${n.state}: ${n.reason})`);
  const i = c.independent;
  L.push(`Independent check (resourcecontainers under ${c.scope.kind === "managementGroup" ? `management group ${c.scope.managementGroup}` : "the chosen subscriptions"}): ${i.found} found`);
  L.push(`Independent list: ${c.scope.containers.length ? c.scope.containers.join(", ") : "none"}`);
  if (i.onlyInAccountList.length) L.push(`  only in az account list: ${i.onlyInAccountList.join(", ")}`);
  if (i.onlyInContainers.length) L.push(`  only in resourcecontainers: ${i.onlyInContainers.join(", ")}`);
  L.push(c.scope.complete ? "Scope: complete" : "Scope: INCOMPLETE (a clean result for a check would be reported as scope-incomplete, never as pass)");
  L.push(`Redaction: ${c.redact}`);
  L.push(`Query budget: ${c.queryBudget}`);
  L.push(`MCP: ${c.mcp.replace("-", " ")}`);
  L.push("Data passes through the model provider (everything the engine writes into a summary is sent to it as part of the conversation), even when only the collector is used. The collector does not remove this risk; the retention and terms of the provider are yours to check against your company policy.");
  const n = need(c);
  const req = Object.entries({ retention: n.retention, acceptance: n.acceptance, previousStage: n.previousStage, identityUnverifiable: n.identityUnverifiable, unclassifiedRoles: n.unclassifiedRoles, outputFolder: n.outputFolder }).filter(([, v]) => v).map(([k]) => k);
  L.push(`Typed confirmations for this stage: ${req.length ? req.join(", ") : "none beyond yes"}`);
  const k = c.acks;
  L.push(`Confirmations recorded once you type them: retention ${yn(k.retention)}, acceptance ${yn(k.acceptance)}, previous stage ${k.previousStage ? (k.previousStage.skipped ? "skipped" : `reviewed (run ${k.previousStage.run})`) : "not applicable"}, unverified identity ${yn(k.identityUnverifiable)}, unclassified roles ${yn(k.unclassifiedRoles)}, output folder ${yn(k.outputFolder)}`);
  return L.join("\n");
}

const strip = (c) => { const { textSha256, storedText, storedTextSha256, ...rest } = c; void textSha256; void storedText; void storedTextSha256; return rest; };
const namesOf = (c) => new Map(c.accounts.filter((a) => typeof a.name === "string").map((a) => [a.id, a.name]));
/** The text kept in consent.json: the screen with the names the file stores (none in the strict mode). */
export const storedTextOf = (c) => buildConsentText(strip(c), namesOf(c));
export const consentSha = (c) => canonicalSha(c);

// ---------------------------------------------------------------------------------------------------------------- validation of the file
const isStr = (v) => typeof v === "string" && v !== "";
const HEX64 = /^[0-9a-f]{64}$/;

/** @returns {string[]} what is wrong with a consent.json (empty when it is internally consistent and derivable) */
export function consentProblems(c, { runId } = {}) {
  const p = [];
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["consent.json is not an object"];
  for (const k of Object.keys(c)) if (!TOP_KEYS.has(k)) p.push(`unknown field "${k}"`);
  if (c.schema !== "waf-consent/1") p.push("schema is not waf-consent/1");
  if (runId !== undefined && c.runId !== runId) p.push(`runId ${JSON.stringify(c.runId)} is not the run folder's ${JSON.stringify(runId)}`);
  try { checkRunId(c.runId, "runId"); } catch (e) { p.push(e.message); }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(c.createdAt ?? "")) p.push("createdAt is not a UTC time");
  if (!STAGES.includes(c.stage)) p.push("stage is not nonprod, one-prod or root-mg");
  if (!["default", "strict"].includes(c.redact)) p.push("redact is not default or strict");
  if (!Number.isInteger(c.queryBudget) || c.queryBudget < 1 || c.queryBudget > 100000) p.push("queryBudget is not an integer from 1 to 100000");
  if (!Number.isInteger(c.expectedSubs) || c.expectedSubs < 1) p.push("expectedSubs is not a positive integer");
  if (c.mcp !== "not-used") p.push("mcp must be not-used in this build");
  const t = c.tenant;
  if (!(typeof t?.last4 === "string" && t.last4.length === 4 && HEX64.test(t?.sha256 ?? ""))) p.push("tenant needs last4 and sha256");
  const id = c.identity;
  if (!id || !["user", "servicePrincipal", "other"].includes(id.type) || typeof id.principalVerified !== "boolean" || !Array.isArray(id.roles) || !Array.isArray(id.unclassified)) p.push("identity is incomplete");
  const table = consentCatalog().roles;
  if (id && Array.isArray(id.roles)) {
    for (const r of id.roles) {
      if (!GUID_RE.test(r?.guid ?? "") && r?.guid !== "(unreadable role id)") p.push(`role ${JSON.stringify(r?.guid)} is not a GUID`);
      else if (table.write[r.guid]) p.push(`the identity holds ${table.write[r.guid]}, a write-capable role`);
      else if (!table.read[r.guid] && !(id.unclassified ?? []).includes(r.guid)) p.push(`role ${r.guid} is neither read-only nor listed as unclassified`);
    }
    if ((id.unclassified ?? []).length && c.acks?.unclassifiedRoles !== true) p.push("unclassified roles without the typed acknowledgment");
    if ((!id.principalVerified || id.roles.length === 0) && c.acks?.identityUnverifiable !== true) p.push("an unverified identity without the typed acknowledgment");
  }
  if (!(isStr(c.az?.path) && c.az.windowsLauncher === false && isStr(c.az?.version))) p.push("az record is incomplete or names a Windows launcher");
  else if (/\.(exe|cmd|bat)$/i.test(c.az.path)) p.push("az path ends in .exe, .cmd or .bat");
  if (!(c.profile?.isolated === true && isStr(c.profile?.dir))) p.push("the profile is not recorded as isolated");
  if (!isStr(c.outputFolder?.path) || !(c.outputFolder.problem === null || isStr(c.outputFolder.problem))) p.push("outputFolder is incomplete");
  else if (c.outputFolder.problem && c.acks?.outputFolder !== true) p.push("an output folder with a problem and no typed acknowledgment");
  const s = c.scope;
  if (!s || !Array.isArray(s.subscriptions) || !Array.isArray(s.notCovered) || !Array.isArray(c.accounts)) p.push("scope is incomplete");
  else {
    if (s.subscriptions.some((x) => !GUID_RE.test(x)) || new Set(s.subscriptions).size !== s.subscriptions.length) p.push("scope.subscriptions must be unique GUIDs");
    if (c.stage === "root-mg") { if (s.kind !== "managementGroup" || !MG_RE.test(s.managementGroup ?? "")) p.push("stage root-mg needs a management group scope"); }
    else if (s.kind !== "subscriptions" || s.managementGroup !== null) p.push(`stage ${c.stage} needs a subscriptions scope without a management group`);
    if (s.visible !== s.subscriptions.length) p.push("scope.visible differs from the number of subscriptions");
    if (s.expected !== c.expectedSubs) p.push("scope.expected differs from the typed count");
    if (c.readSubs !== s.visible) p.push("readSubs differs from scope.visible");
    if (c.expectedSubs !== c.readSubs) p.push("the typed count differs from the count read: the file is not a valid consent");
    if (s.complete !== (s.notCovered.length === 0 && s.visible === s.expected)) p.push("scope.complete does not follow from notCovered and the counts");
    if (c.stage === "one-prod" && s.subscriptions.length !== 1) p.push("stage one-prod is exactly one subscription");
    const enabled = new Set(c.accounts.filter((a) => a?.state === "Enabled").map((a) => a.id));
    for (const x of s.subscriptions) if (!enabled.has(x)) p.push(`subscription ${x} is in scope but not Enabled in the account list`);
    for (const n of s.notCovered) if (!(GUID_RE.test(n?.id ?? "") && isStr(n?.state) && isStr(n?.reason))) p.push("a notCovered entry is incomplete");
    for (const x of s.notCovered) if (s.subscriptions.includes(x?.id)) p.push(`subscription ${x.id} is both covered and not covered`);
  }
  const i = c.independent;
  if (!(i && Number.isInteger(i.found) && Array.isArray(i.onlyInAccountList) && Array.isArray(i.onlyInContainers))) p.push("the independent check is not recorded");
  const k = c.acks;
  if (!k || typeof k !== "object") p.push("acks are missing");
  else {
    const must = c.stage !== "nonprod";
    if (must && (k.retention !== true || k.acceptance !== true)) p.push(`stage ${c.stage} needs the retention and the acceptance confirmations`);
    if (!must && (k.retention || k.acceptance || k.previousStage)) p.push("confirmations of a production stage on a nonprod consent");
    if (must) {
      const ps = k.previousStage;
      if (!(ps && typeof ps.reviewed === "boolean" && typeof ps.skipped === "boolean" && ps.reviewed !== ps.skipped && (ps.reviewed ? isStr(ps.run) : ps.run === null))) p.push("the previous-stage confirmation is incomplete");
    } else if (k.previousStage !== null) p.push("previousStage must be null on nonprod");
    for (const key of ["retention", "acceptance", "identityUnverifiable", "unclassifiedRoles", "outputFolder"]) if (typeof k[key] !== "boolean") p.push(`acks.${key} must be true or false`);
  }
  // the text: hash of the stored text, and the stored text derived again from the fields
  if (!HEX64.test(c.storedTextSha256 ?? "") || sha256(String(c.storedText ?? "")) !== c.storedTextSha256) p.push("storedTextSha256 is not the hash of storedText");
  if (!p.length) {
    let derived = null;
    try { derived = storedTextOf(c); } catch (e) { p.push(`the text cannot be derived from the fields (${e.message})`); }
    if (derived !== null && derived !== c.storedText) p.push("the stored text is not what the fields produce: a field or the text was edited");
  }
  if (!HEX64.test(c.textSha256 ?? "")) p.push("textSha256 is missing");
  else if (c.redact === "default" && c.textSha256 !== c.storedTextSha256) p.push("in the default mode the hash of the text shown must equal the hash of the stored text");
  return p;
}

/** Reads and validates `<runDir>/consent.json`. @returns {{consent: object|null, sha256: string|null, problems: string[]}} */
export function readConsent(runDir, runId) {
  const f = join(runDir, "consent.json");
  let st;
  try { st = lstatSync(f); } catch { return { consent: null, sha256: null, problems: ["consent.json is missing: ask the user to run `waf.mjs consent` in their own terminal"] }; }
  if (st.isSymbolicLink() || !st.isFile()) return { consent: null, sha256: null, problems: ["consent.json must be a regular file"] };
  let c;
  try { c = JSON.parse(readFileSync(f, "utf8")); } catch (e) { return { consent: null, sha256: null, problems: [`consent.json is not valid JSON (${e.message})`] }; }
  return { consent: c, sha256: consentSha(c), problems: consentProblems(c, { runId }) };
}

// ---------------------------------------------------------------------------------------------------------------- the previous stage
/** A run of the previous stage in this working folder: a VALID consent.json of that stage and a collected manifest. Most recent first. */
export function findPreviousStage({ base, stage, exclude }) {
  const want = PREVIOUS_STAGE[stage];
  if (!want || !existsSync(base)) return null;
  const found = [];
  for (const name of readdirSync(base)) {
    if (name === exclude) continue;
    const dir = join(base, name);
    let st;
    try { st = lstatSync(dir); } catch { continue; }
    if (st.isSymbolicLink() || !st.isDirectory()) continue;
    const { consent, problems } = readConsent(dir, name);
    if (!consent || problems.length || consent.stage !== want) continue;
    if (!existsSync(join(dir, "collected", "manifest.json"))) continue;
    found.push({ runId: name, createdAt: consent.createdAt });
  }
  found.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return found[0]?.runId ?? null;
}

// ---------------------------------------------------------------------------------------------------------------- the flow
const refuse = (code, reason, message) => ({ ok: false, code, reason, message });
const lineOf = (s) => String(s).replace(/\r$/, "");
const lastLine = (t) => String(t ?? "").trim().split("\n")[0] ?? "";

async function readGraph(transport, checkId, query, scopeFields) {
  const r = await transport.resourceGraph({ query, ...scopeFields, options: { $top: 1000, resultFormat: "objectArray" } }, { checkId, role: "violations", page: 1 });
  if (r.status !== 200) return { error: r.errorClass ?? "error" };
  if (!Array.isArray(r.body?.data)) return { error: "format" };
  if (r.body.$skipToken || String(r.body.resultTruncated).toLowerCase() === "true") return { error: "truncated" };
  return { rows: r.body.data };
}

/**
 * Runs the consent. Everything that touches the world is injected: `transport` (the production `az` transport or a stub), `io` ({ask, print}),
 * the environment, the platform and the clock. Writes `<cwd>/waf-review/<runId>/consent.json` only after an explicit yes.
 * @returns {Promise<{ok:true, consent:object, file:string}|{ok:false, code:number, reason:string, message:string}>}
 */
export async function runConsent({ args, transport, io, cwd, env = process.env, platform = process.platform, wsl = false, azPath, now = () => new Date().toISOString(), cwdReal = null }) {
  let a;
  try { a = parseConsentArgs(args); } catch (e) { if (e instanceof UsageError) return refuse(2, "usage", e.message); throw e; }
  const runId = args.runId;
  const base = join(cwd, "waf-review");
  const runDir = join(base, runId);
  if (existsSync(join(runDir, "consent.json")) || existsSync(join(runDir, "run.json"))) return refuse(1, "exists", `${runDir} already has a consent.json or run.json; consent never overwrites. Choose another --run-id.`);

  // the platform, before any read
  if (platform === "win32") return refuse(1, "platform-windows", "native Windows is not supported by the production transport in this build (it fails closed); run the audit inside WSL Ubuntu with the Azure CLI installed there (manual test M-10 covers native Windows)");
  const az = classifyAzPath(azPath ?? "", { wsl, platform });
  if (!az.ok || /\.(exe|cmd|bat)$/i.test(String(azPath))) return refuse(1, "az-windows-launcher", `the az launcher is refused: ${az.reason ?? `${azPath} is a Windows launcher`}. Install the Azure CLI inside the Linux distro.`);
  const profile = isolatedProfileProblem({ env, home: env.HOME ?? "", platform });
  if (profile) return refuse(1, "profile-not-isolated", `the Azure CLI profile is not isolated: ${profile}. Create an audit-only folder, set AZURE_CONFIG_DIR to it, and sign in to it yourself with the dedicated identity.`);
  const folderProblem = runBaseProblem(cwdReal ?? safeReal(cwd), { platform });

  // reads: only the closed list
  const ver = await transport.azRead(["az", "--version"]);
  if (ver.status !== 200) return refuse(2, "no-az", "az did not run (az --version failed); install the Azure CLI inside this Linux distro");
  const azVersion = screenSafe(lastLine(ver.text ?? (typeof ver.body === "string" ? ver.body : "")), 80) || "azure-cli (version not read)";
  const show = await transport.azRead(["az", "account", "show", "--output", "json"]);
  if (show.status !== 200 || !show.body || typeof show.body !== "object") return refuse(2, "not-logged-in", "no valid Azure login in this profile. Sign in yourself, in this terminal and with the dedicated identity: az login. This engine never logs in.");
  const tenantId = String(show.body.tenantId ?? "").toLowerCase();
  if (!GUID_RE.test(tenantId)) return refuse(2, "not-logged-in", "az account show did not return a tenant id; sign in yourself with: az login");
  const utype = show.body.user?.type === "user" ? "user" : show.body.user?.type === "servicePrincipal" ? "servicePrincipal" : "other";
  const list = await transport.azRead(["az", "account", "list", "--all", "--output", "json"]);
  if (list.status !== 200 || !Array.isArray(list.body)) return refuse(2, "no-account-list", "az account list --all failed; sign in again yourself: az login");
  const accounts = list.body.filter((x) => x && GUID_RE.test(String(x.id ?? ""))).map((x) => ({ id: String(x.id).toLowerCase(), name: String(x.name ?? ""), state: String(x.state ?? "Unknown"), tenantId: String(x.tenantId ?? "").toLowerCase() }));

  // the principal id (a user, or a service principal whose name is a GUID) and its role assignments
  let principalId = null;
  if (utype === "user") {
    const r = await transport.azRead(["az", "ad", "signed-in-user", "show", "--query", "id", "--output", "tsv"]);
    principalId = r.status === 200 ? lastLine(r.text ?? r.body).toLowerCase() : null;
  } else if (utype === "servicePrincipal" && GUID_RE.test(String(show.body.user?.name ?? ""))) {
    const r = await transport.azRead(["az", "ad", "sp", "show", "--id", String(show.body.user.name).toLowerCase(), "--query", "id", "--output", "tsv"]);
    principalId = r.status === 200 ? lastLine(r.text ?? r.body).toLowerCase() : null;
  }
  if (principalId !== null && !GUID_RE.test(principalId)) principalId = null;

  const scopeFields = a.stage === "root-mg" ? { managementGroups: [a.mg] } : { subscriptions: a.subs };
  const cc = consentCatalog();
  const subsCheck = cc.checks.find((c) => c.id === "CONSENT-SUBS");
  const rolesCheck = cc.checks.find((c) => c.id === "CONSENT-ROLES");
  const subsRead = await readGraph(transport, "CONSENT-SUBS", subsCheck.query, scopeFields);
  if (subsRead.error) return refuse(1, "independent-check-failed", `the independent subscription check (resourcecontainers) failed (${subsRead.error}); the typed count cannot be the only protection, so there is no consent without it`);
  const containers = new Map(subsRead.rows.map((r) => [String(r.subscriptionId ?? "").toLowerCase(), screenSafe(r.displayName ?? "")]).filter(([k]) => GUID_RE.test(k)));

  let roleRows = [];
  let rolesRead = false;
  if (principalId) {
    const q = rolesCheck.query.replace(rolesCheck.placeholder, principalId);
    if (kqlProblems(q).length) throw new Error("the CONSENT-ROLES query does not pass the KQL allowlist");
    const rr = await readGraph(transport, "CONSENT-ROLES", q, scopeFields);
    if (!rr.error) { roleRows = rr.rows; rolesRead = true; }
  }
  const roles = classifyRoleAssignments(roleRows, cc.roles);

  // the scope: what the identity can read, against the independent list
  const inTenant = accounts.filter((x) => x.tenantId === tenantId || !x.tenantId);
  const byId = new Map(inTenant.map((x) => [x.id, x]));
  const scopeIds = a.stage === "root-mg" ? [...containers.keys()] : a.subs;
  const readable = [];
  const notCovered = [];
  for (const id of scopeIds) {
    const acct = byId.get(id);
    if (!acct) notCovered.push({ id, state: "not-readable", reason: "not in az account list for this tenant (the identity cannot read it)" });
    else if (acct.state !== "Enabled") notCovered.push({ id, state: acct.state, reason: "subscription state" });
    else if (!containers.has(id)) notCovered.push({ id, state: "not-in-resourcecontainers", reason: "readable by az but not returned by resourcecontainers" });
    else readable.push(id);
  }
  const onlyInAccountList = scopeIds.filter((id) => byId.get(id)?.state === "Enabled" && !containers.has(id));
  const onlyInContainers = [...containers.keys()].filter((id) => !byId.has(id));
  const accountEntries = [...new Set(scopeIds)].sort().map((id) => ({ id, state: byId.get(id)?.state ?? "not-readable", ...(byId.has(id) ? { name: screenSafe(byId.get(id).name) } : containers.has(id) ? { name: containers.get(id) } : {}) }));
  const complete = notCovered.length === 0 && readable.length === a.expected;

  const principalVerified = Boolean(principalId) && rolesRead;
  const fields = {
    schema: "waf-consent/1", runId, createdAt: now(), stage: a.stage, redact: a.redact, queryBudget: a.budget, expectedSubs: a.expected, readSubs: readable.length,
    tenant: { last4: tenantId.slice(-4), sha256: sha256(tenantId) },
    identity: { type: utype, principalVerified, roles: [...roles.read, ...roles.write, ...roles.other], unclassified: roles.other.map((r) => r.guid) },
    az: { path: String(azPath), windowsLauncher: false, version: azVersion },
    profile: { isolated: true, dir: String(env.AZURE_CONFIG_DIR) },
    outputFolder: { path: join(cwdReal ?? safeReal(cwd), "waf-review"), problem: folderProblem },
    scope: { kind: a.stage === "root-mg" ? "managementGroup" : "subscriptions", managementGroup: a.mg, subscriptions: readable, visible: readable.length, expected: a.expected, containers: [...containers.keys()], notCovered, complete },
    accounts: a.redact === "strict" ? accountEntries.map(({ name, ...x }) => { void name; return x; }) : accountEntries,
    independent: { found: containers.size, onlyInAccountList, onlyInContainers },
    acks: { retention: false, acceptance: false, previousStage: null, identityUnverifiable: false, unclassifiedRoles: false, outputFolder: false },
    mcp: "not-used",
  };
  const realNames = new Map(accountEntries.filter((x) => x.name !== undefined).map((x) => [x.id, x.name]));
  const required = need({ ...fields });
  // the screen shows what the acknowledgments are for, so the text is built with the acknowledgments as they will be recorded
  const planned = structuredClone(fields);
  planned.acks = { retention: required.retention, acceptance: required.acceptance, previousStage: required.previousStage ? { reviewed: false, run: null, skipped: false } : null, identityUnverifiable: required.identityUnverifiable, unclassifiedRoles: required.unclassifiedRoles, outputFolder: required.outputFolder };
  let previousRun = null;
  if (required.previousStage) previousRun = findPreviousStage({ base, stage: a.stage, exclude: runId });
  const preview = buildConsentText({ ...planned, acks: { ...planned.acks, previousStage: required.previousStage ? { reviewed: Boolean(previousRun), run: previousRun, skipped: !previousRun } : null } }, realNames);
  io.print(preview);

  // refusals that no typed word can override
  if (roles.write.length) return refuse(1, "write-role", `the identity holds a write-capable role (${[...new Set(roles.write.map((r) => r.name))].join(", ")}). Use a dedicated identity with only Reader and Security Reader; this engine never accepts an acknowledgment for it.`);
  if (a.expected !== readable.length) {
    io.print(`Result: scope-incomplete: you typed ${a.expected} subscription(s) and ${readable.length} were read. No consent was written. Fix the identity's access or the list, and run consent again.`);
    return refuse(1, "scope-count", `scope-incomplete: typed ${a.expected}, read ${readable.length}`);
  }

  // typed confirmations, in a fixed order; any other word ends the consent and nothing is written
  const accepted = { outputFolder: false, identityUnverifiable: false, unclassifiedRoles: false, retention: false, acceptance: false };
  const typed = async (phrase, question) => lineOf(await io.ask(`${question}\nType exactly: ${phrase}\n> `)) === phrase;
  const abort = (what, reason = "aborted") => refuse(1, reason, `${what}: the typed answer was not exact. Nothing was written.`);
  if (required.outputFolder) { if (!(await typed(PHRASES.folder, `The run folder would be under a path with a problem (${folderProblem}).`))) return abort("output folder", "folder"); accepted.outputFolder = true; }
  if (required.identityUnverifiable) { if (!(await typed(PHRASES.unverifiable, "The identity's own role assignments could not be verified as read-only."))) return abort("identity", "identity-unverifiable"); accepted.identityUnverifiable = true; }
  if (required.unclassifiedRoles) { if (!(await typed(PHRASES.unclassified, `Roles that are not on the read-only list: ${roles.other.map((r) => r.guid).join(", ")}.`))) return abort("unclassified roles", "unclassified-role"); accepted.unclassifiedRoles = true; }
  let previousStage = null;
  if (a.stage !== "nonprod") {
    if (!(await typed(PHRASES.retention, "Did you check the model provider's retention and terms against your company policy?"))) return abort("retention");
    accepted.retention = true;
    if (!(await typed(PHRASES.acceptance, "Is a security or compliance acceptance of the deviation from the Azure MCP guidance recorded (a decision record)?"))) return abort("acceptance");
    accepted.acceptance = true;
    if (previousRun) {
      if (!(await typed(PHRASES.previous, `The previous stage (${PREVIOUS_STAGE[a.stage]}) ran in run ${previousRun}. Did you review its report?`))) return abort("previous stage");
      previousStage = { reviewed: true, run: previousRun, skipped: false };
    } else {
      if (!(await typed(PHRASES.skip, `No run of the previous stage (${PREVIOUS_STAGE[a.stage]}) was found with a collected manifest. Stages skipped are recorded and the report says so.`))) return abort("previous stage");
      previousStage = { reviewed: false, run: null, skipped: true };
    }
  }
  if (lineOf(await io.ask("Write the consent and allow the review to read this scope? Type yes to confirm.\n> ")) !== PHRASES.yes) return abort("consent");

  const consent = { ...fields, acks: { ...accepted, previousStage } };
  consent.storedText = storedTextOf(consent);
  consent.storedTextSha256 = sha256(consent.storedText);
  consent.textSha256 = sha256(buildConsentText(strip(consent), realNames));
  // the hash covers the exact text printed above: the preview used the same function with the same acknowledgments
  const problems = consentProblems(consent, { runId });
  if (problems.length) throw new Error(`internal error: the consent is not consistent (${problems[0]})`);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  try { chmodSync(runDir, 0o700); } catch { /* not supported on this platform */ }
  if (!existsSync(join(base, ".gitignore"))) writeFileAtomic(join(base, ".gitignore"), "*\n");
  const file = join(runDir, "consent.json");
  writeJsonFile(file, consent, 0o600);
  io.print(`Consent written: ${file}`);
  return { ok: true, consent, file };
}

function safeReal(p) { try { return realpathSync(p); } catch { return p; } }

export { isAllowedAzVector };
