// PR 1b, task 1.9: `waf.mjs consent` (user-run), screen sanitization, closed argument vectors, identity and scope checks, stages,
// typed confirmations. Written BEFORE the implementation: every test here fails on the 1a code (no consent module, no command).
// Toy transports prove only which vectors the engine asks for and what it does with a documented answer shape; they are not
// Azure (manual tests M-0 and M-3 in PR 5).
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isAllowedAzVector } from "../scripts/lib/azread.mjs";
import { kqlProblems } from "../scripts/lib/kql.mjs";
import { sha256 } from "../scripts/lib/util.mjs";
import { createAzTransport } from "../scripts/lib/transport.mjs";
import { PHRASES, PRINCIPAL, ROLE, SUB1, SUB2, SUB3, TENANT, baseArgs, consentCtx, consentTransport, roleRow, scriptedIo, sub } from "./prod-helpers.mjs";
import { run, tmp, writeJson } from "./helpers.mjs";

const posix = process.platform !== "win32";
const lib = () => import("../scripts/lib/consent.mjs");
const go = async ({ args = baseArgs(), transport = consentTransport(), answers = [PHRASES.yes], ctx = consentCtx(), io = scriptedIo(answers) } = {}) => {
  const { runConsent } = await lib();
  const r = await runConsent({ args, transport, io, ...ctx });
  return { r, io, transport, ctx, file: join(ctx.cwd, "waf-review", args.runId ?? "r1", "consent.json") };
};
const readConsentFile = (file) => JSON.parse(readFileSync(file, "utf8"));

// ------------------------------------------------------------------------------------------------ screen sanitization (N3)
test("screenSafe shows ESC, ANSI, bidi and control characters as text and never emits them", async () => {
  const { screenSafe } = await lib();
  const s = screenSafe("a\u001b[2Jb\u001b]0;title\u0007c\u202ed\u0000e\nf\u009bg\u200bh");
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/.test(s), JSON.stringify(s));
  assert.match(s, /\\u001b/);
  assert.match(s, /\\u202e/);
  assert.match(s, /\\u0007/);
  assert.ok(screenSafe("x".repeat(500)).length <= 130, "a name is capped");
});

test("a subscription named with an ESC sequence reaches neither the screen nor consent.json as a control character", async () => {
  const esc = "sub-nonprod \u001b[2J\u001b[Hcleared\u001b]0;pwned\u0007 \u202egnp";
  const t = consentTransport({ accounts: [sub(SUB1, "sub-prod"), sub(SUB2, esc)] });
  const { r, io, file } = await go({ transport: t });
  assert.equal(r.ok, true, r.message);
  assert.ok(!/[\u001b\u0007\u202e]/.test(io.text()), "the screen holds no control or bidi character");
  assert.match(io.text(), /\\u001b/);
  assert.ok(!/[\u001b\u0007\u202e]/.test(readFileSync(file, "utf8")), "nor does the file");
});

// ------------------------------------------------------------------------------------------------ the typed count
test("the typed expected count is plain ASCII digits and nothing else", async () => {
  const { parseExpectedSubs } = await lib();
  assert.equal(parseExpectedSubs("3"), 3);
  assert.equal(parseExpectedSubs("120"), 120);
  for (const bad of [" 3", "3 ", "3\n", "\t3", "\uFF13", "3\u200b", "\u06f3", "03", "+3", "-3", "3.0", "0x3", "1e1", "", "0", "٣", "10000", "3,2", "three"]) assert.throws(() => parseExpectedSubs(bad), /expected-subs/i, JSON.stringify(bad));
});

test("a count typed with whitespace or a look-alike digit is a usage error and nothing is read", async () => {
  for (const bad of [" 2", "2 ", "\uFF12", "2\u200b"]) {
    const t = consentTransport();
    const { r, file } = await go({ args: baseArgs({ expectedSubs: bad }), transport: t });
    assert.equal(r.ok, false);
    assert.equal(r.code, 2);
    assert.equal(t.calls.length, 0, "no Azure read happens on a bad argument");
    assert.ok(!existsSync(file));
  }
});

test("fewer subscriptions read than typed: scope-incomplete, no valid file", async () => {
  const { r, io, file } = await go({ args: baseArgs({ expectedSubs: "3" }) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
  assert.equal(r.reason, "scope-count");
  assert.match(io.text(), /scope-incomplete/);
  assert.match(io.text(), /expected.*3|3.*expected/i);
  assert.ok(!existsSync(file));
});

test("more read than typed is refused too", async () => {
  const { r } = await go({ args: baseArgs({ expectedSubs: "1" }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "scope-count");
});

// ------------------------------------------------------------------------------------------------ the closed vectors
test("consent asks Azure only for the closed list: every az vector and both catalog checks", async () => {
  const t = consentTransport();
  const { r } = await go({ transport: t });
  assert.equal(r.ok, true, r.message);
  const az = t.calls.filter((c) => c.type === "az");
  assert.ok(az.length >= 4, JSON.stringify(az));
  for (const c of az) assert.ok(isAllowedAzVector(c.vector), `vector outside the list: ${JSON.stringify(c.vector)}`);
  assert.ok(!az.some((c) => c.vector.some((a) => /get-access-token|keyvault|appsettings|keys|credential/i.test(a))));
  const arg = t.calls.filter((c) => c.type === "arg");
  assert.deepEqual(arg.map((c) => c.checkId).sort(), ["CONSENT-ROLES", "CONSENT-SUBS"]);
  for (const c of arg) assert.deepEqual(kqlProblems(c.req.query), [], c.req.query);
  // the principal id goes into the request body of the roles query and into no argument vector
  assert.ok(arg.find((c) => c.checkId === "CONSENT-ROLES").req.query.includes(PRINCIPAL));
  assert.ok(!JSON.stringify(az).includes(PRINCIPAL));
});

test("the real transport turns the consent reads into these exact argument lists, and a vector outside the list never starts a process", async () => {
  const started = [];
  const spawnFile = (file, args, opts, cb) => {
    started.push(args);
    const a = args.join(" ");
    if (args[0] === "--version") cb(null, "azure-cli 2.99.0\n", "");
    else if (a.startsWith("account show")) cb(null, JSON.stringify({ id: SUB1, tenantId: TENANT, user: { name: "audit@example.invalid", type: "user" } }), "");
    else if (a.startsWith("account list")) cb(null, JSON.stringify([sub(SUB1, "a"), sub(SUB2, "b")]), "");
    else if (args[0] === "ad") cb(null, `${PRINCIPAL}\n`, "");
    else cb(null, JSON.stringify({ data: [], resultTruncated: "false" }), "");
  };
  const transport = createAzTransport({ azPath: "/usr/bin/az", platform: "linux", spawnFile, workDir: tmp("waf-body-") });
  const { runConsent } = await lib();
  const ctx = consentCtx();
  const io = scriptedIo([PHRASES.yes]);
  await runConsent({ args: baseArgs(), transport, io, ...ctx });
  const heads = started.map((a) => a.join(" "));
  assert.ok(heads.includes("--version"));
  assert.ok(heads.some((h) => h.startsWith("account show --output json")));
  assert.ok(heads.some((h) => h.startsWith("account list --all --output json")));
  assert.ok(heads.some((h) => h.startsWith("ad signed-in-user show")));
  assert.equal(started.filter((a) => a[0] === "rest").length, 2);
  for (const a of started.filter((x) => x[0] === "rest")) assert.deepEqual(a.slice(0, 5), ["rest", "--method", "post", "--url", "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01"]);
  assert.ok(!started.flat().some((x) => /login|get-access-token|--debug|--verbose/.test(x)));
  const n = started.length;
  await assert.rejects(transport.azRead(["az", "account", "get-access-token"]), /closed list/);
  await assert.rejects(transport.azRead(["az", "ad", "sp", "show", "--id", "not-a-guid", "--query", "id", "--output", "tsv"]), /closed list/);
  assert.equal(started.length, n);
});

test("a service principal is looked up with az ad sp show and a validated GUID, a user with signed-in-user", async () => {
  const t = consentTransport({ user: { name: SUB3, type: "servicePrincipal" } });
  const { r } = await go({ transport: t });
  assert.equal(r.ok, true, r.message);
  const v = t.calls.filter((c) => c.type === "az" && c.vector[1] === "ad").map((c) => c.vector);
  assert.deepEqual(v, [["az", "ad", "sp", "show", "--id", SUB3, "--query", "id", "--output", "tsv"]]);
  const bad = consentTransport({ user: { name: "not a guid; rm -rf", type: "servicePrincipal" } });
  const g = await go({ transport: bad, answers: [PHRASES.unverifiable, PHRASES.yes] });
  assert.ok(!bad.calls.some((c) => c.type === "az" && c.vector[1] === "ad"), "a name that is not a GUID never becomes an argument");
  assert.equal(g.r.ok, true);
  assert.equal(readConsentFile(g.file).identity.principalVerified, false);
});

// ------------------------------------------------------------------------------------------------ platform and profile
test("a Windows az inside WSL is refused before any Azure read", async () => {
  for (const azPath of ["/mnt/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin/az.cmd", "/mnt/c/anything/az", "/usr/bin/az.exe", "/opt/x/az.cmd"]) {
    const t = consentTransport();
    const { r, file } = await go({ transport: t, ctx: consentCtx({ azPath, wsl: true }) });
    assert.equal(r.ok, false, azPath);
    assert.equal(r.reason, "az-windows-launcher");
    assert.equal(t.calls.length, 0);
    assert.ok(!existsSync(file));
  }
});

test("a Linux az is accepted inside WSL and its path is printed and recorded", async () => {
  const { r, io, file } = await go({ ctx: consentCtx({ azPath: "/usr/bin/az", wsl: true }) });
  assert.equal(r.ok, true, r.message);
  assert.match(io.text(), /\/usr\/bin\/az/);
  assert.equal(readConsentFile(file).az.path, "/usr/bin/az");
});

test("native Windows is refused: the production transport fails closed there (manual test M-10)", async () => {
  const t = consentTransport();
  const { r } = await go({ transport: t, ctx: consentCtx({ platform: "win32", azPath: "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd" }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "platform-windows");
  assert.match(r.message, /WSL/);
  assert.equal(t.calls.length, 0);
});

test("a profile that is not isolated is refused: unset, the default ~/.azure, missing, relative", async () => {
  const mk = (mut) => { const c = consentCtx(); mut(c.env, c); return c; };
  const cases = [
    mk((env) => { delete env.AZURE_CONFIG_DIR; }),
    mk((env) => { env.AZURE_CONFIG_DIR = join(env.HOME, ".azure"); }),
    mk((env) => { env.AZURE_CONFIG_DIR = `${env.HOME}/.azure/`; }),
    mk((env) => { env.AZURE_CONFIG_DIR = join(tmp("waf-gone-"), "does-not-exist"); }),
    mk((env) => { env.AZURE_CONFIG_DIR = "relative/dir"; }),
    mk((env) => { env.AZURE_CONFIG_DIR = env.HOME; }),
  ];
  for (const ctx of cases) {
    const t = consentTransport();
    const { r } = await go({ transport: t, ctx });
    assert.equal(r.ok, false, JSON.stringify(ctx.env));
    assert.equal(r.reason, "profile-not-isolated");
    assert.equal(t.calls.length, 0);
  }
});

test("an isolated profile is recorded and printed", async () => {
  const ctx = consentCtx();
  const { r, io, file } = await go({ ctx });
  assert.equal(r.ok, true, r.message);
  assert.match(io.text(), /isolated/i);
  assert.equal(readConsentFile(file).profile.isolated, true);
});

// ------------------------------------------------------------------------------------------------ identity
test("a write-capable role aborts: Owner, Contributor, User Access Administrator, even next to Reader", async () => {
  for (const guid of [ROLE.owner, ROLE.contributor, ROLE.uaa]) {
    const t = consentTransport({ roles: [roleRow(ROLE.reader), roleRow(guid)] });
    const { r, io, file } = await go({ transport: t, answers: ["yes", "yes", "yes", PHRASES.unclassified] });
    assert.equal(r.ok, false, guid);
    assert.equal(r.reason, "write-role");
    assert.match(io.text(), /Owner|Contributor|User Access Administrator/);
    assert.ok(!existsSync(file));
    assert.equal(io.asked.length, 0, "no acknowledgment can override a write-capable role");
  }
});

test("Reader and Security Reader are the only roles accepted without a question", async () => {
  const { r, file } = await go();
  assert.equal(r.ok, true, r.message);
  const c = readConsentFile(file);
  assert.deepEqual(c.identity.roles.map((x) => x.name).sort(), ["Reader", "Security Reader"]);
  assert.equal(c.identity.principalVerified, true);
});

test("a role that is not on the list needs a typed acknowledgment, which is recorded", async () => {
  const t = consentTransport({ roles: [roleRow(ROLE.reader), roleRow(ROLE.custom)] });
  const refused = await go({ transport: t, answers: ["no"] });
  assert.equal(refused.r.ok, false);
  const ok = await go({ transport: consentTransport({ roles: [roleRow(ROLE.reader), roleRow(ROLE.custom)] }), answers: [PHRASES.unclassified, PHRASES.yes] });
  assert.equal(ok.r.ok, true, ok.r.message);
  const c = readConsentFile(ok.file);
  assert.equal(c.acks.unclassifiedRoles, true);
  assert.deepEqual(c.identity.unclassified, [ROLE.custom]);
});

test("no role assignment visible for the principal is unverifiable: refused without an acknowledgment", async () => {
  const none = await go({ transport: consentTransport({ roles: [] }), answers: ["x"] });
  assert.equal(none.r.ok, false);
  const ok = await go({ transport: consentTransport({ roles: [] }), answers: [PHRASES.unverifiable, PHRASES.yes] });
  assert.equal(ok.r.ok, true, ok.r.message);
  assert.equal(readConsentFile(ok.file).acks.identityUnverifiable, true);
});

test("the principal id cannot be read: refused unless the user types an acknowledgment, recorded", async () => {
  const no = await go({ transport: consentTransport({ failPrincipal: true }), answers: ["no"] });
  assert.equal(no.r.ok, false);
  assert.equal(no.r.reason, "identity-unverifiable");
  const ok = await go({ transport: consentTransport({ failPrincipal: true }), answers: [PHRASES.unverifiable, PHRASES.yes] });
  assert.equal(ok.r.ok, true, ok.r.message);
  const c = readConsentFile(ok.file);
  assert.equal(c.identity.principalVerified, false);
  assert.equal(c.acks.identityUnverifiable, true);
});

test("no login: exit code 2 and the instruction for the user; the engine never logs in", async () => {
  const t = consentTransport({ noLogin: true });
  const { r } = await go({ transport: t });
  assert.equal(r.ok, false);
  assert.equal(r.code, 2);
  assert.match(r.message, /az login/);
  assert.ok(!t.calls.some((c) => c.type === "az" && c.vector.includes("login")));
});

test("the identity name is never written to consent.json (it is an Entra user name)", async () => {
  const { r, file } = await go();
  assert.equal(r.ok, true);
  const text = readFileSync(file, "utf8");
  assert.ok(!text.includes("audit@example.invalid"));
  assert.ok(!text.includes("@"));
  assert.match(text, new RegExp(TENANT.slice(-4)));
  assert.ok(!text.includes(TENANT), "the tenant id is shown by its last four characters and a hash");
});

// ------------------------------------------------------------------------------------------------ subscription states and the independent check
test("Disabled, Warned and PastDue subscriptions are named and not counted as covered", async () => {
  for (const state of ["Disabled", "Warned", "PastDue"]) {
    const accounts = [sub(SUB1, "a"), sub(SUB2, "b"), sub(SUB3, "c", state)];
    const { r, io, file } = await go({ args: baseArgs({ expectedSubs: "2", subscriptions: `${SUB1},${SUB2},${SUB3}` }), transport: consentTransport({ accounts }) });
    assert.equal(r.ok, true, `${state}: ${r.message}`);
    assert.match(io.text(), new RegExp(state));
    const c = readConsentFile(file);
    assert.equal(c.scope.complete, false);
    assert.deepEqual(c.scope.notCovered.map((n) => [n.id, n.state]), [[SUB3, state]]);
    assert.ok(!c.scope.subscriptions.includes(SUB3));
  }
});

test("root-mg: the independent resourcecontainers list under the management group exposes a subscription the identity cannot read", async () => {
  const containers = [{ id: SUB1 }, { id: SUB2 }, { id: SUB3, displayName: "hidden" }];
  const args = { runId: "r1", stage: "root-mg", expectedSubs: "2", managementGroup: "mg-root", redact: "default" };
  const answers = [PHRASES.retention, PHRASES.acceptance, PHRASES.skip, PHRASES.yes];
  const { r, io, file } = await go({ args, transport: consentTransport({ containers }), answers });
  assert.equal(r.ok, true, r.message);
  assert.match(io.text(), new RegExp(SUB3));
  const c = readConsentFile(file);
  assert.equal(c.scope.complete, false, "the typed number equals the number read, and the independent list still says incomplete");
  assert.ok(c.scope.notCovered.some((n) => n.id === SUB3 && n.state === "not-readable"));
  const subsQuery = (await go({ args, transport: consentTransport({ containers }), answers })).transport.calls.find((x) => x.type === "arg" && x.checkId === "CONSENT-SUBS");
  assert.deepEqual(subsQuery.req.managementGroups, ["mg-root"]);
});

test("the readable list lacking a subscription that resourcecontainers shows is a difference, printed", async () => {
  const containers = [{ id: SUB1 }];
  const { io } = await go({ transport: consentTransport({ containers }), answers: [PHRASES.yes] });
  assert.match(io.text(), /only in az account list|not found in resourcecontainers/i);
  assert.match(io.text(), new RegExp(SUB2));
});

// ------------------------------------------------------------------------------------------------ stages
test("the stage arguments are checked: nonprod needs subscriptions, one-prod exactly one, root-mg a management group and no list", async () => {
  const cases = [
    [baseArgs({ stage: "bogus" }), 2],
    [baseArgs({ subscriptions: undefined }), 2],
    [baseArgs({ stage: "one-prod", expectedSubs: "2" }), 2],
    [{ runId: "r1", stage: "root-mg", expectedSubs: "2", redact: "default" }, 2],
    [{ runId: "r1", stage: "root-mg", expectedSubs: "2", managementGroup: "mg-root", subscriptions: `${SUB1}`, redact: "default" }, 2],
    [baseArgs({ managementGroup: "mg-root" }), 2],
    [baseArgs({ managementGroup: "../x", stage: "root-mg", subscriptions: undefined }), 2],
    [baseArgs({ subscriptions: "not-a-guid,also-not" }), 2],
    [baseArgs({ redact: "off" }), 2],
    [baseArgs({ queryBudget: "0" }), 2],
    [baseArgs({ queryBudget: " 5" }), 2],
    [baseArgs({ queryBudget: "1e3" }), 2],
    [baseArgs({ queryBudget: "99999999" }), 2],
    [baseArgs({ runId: "../x" }), 2],
  ];
  for (const [args, code] of cases) {
    const t = consentTransport();
    const { r } = await go({ args, transport: t });
    assert.equal(r.ok, false, JSON.stringify(args));
    assert.equal(r.code, code, JSON.stringify(args));
    assert.equal(t.calls.length, 0);
  }
});

test("promotion to one-prod and root-mg asks for typed confirmations in order; a wrong word aborts and writes nothing", async () => {
  const one = (answers) => go({ args: baseArgs({ stage: "one-prod", expectedSubs: "1", subscriptions: SUB1 }), transport: consentTransport({ accounts: [sub(SUB1, "prod")] }), answers });
  for (const bad of [[PHRASES.retention.toLowerCase()], [PHRASES.retention, " ACCEPTANCE RECORDED"], [PHRASES.retention, PHRASES.acceptance, "PREVIOUS STAGE REVIEWED "], [PHRASES.retention, PHRASES.acceptance, PHRASES.skip, "Yes"], [PHRASES.retention, PHRASES.acceptance, PHRASES.skip, " yes"], [PHRASES.retention, PHRASES.acceptance, PHRASES.skip, "y"]]) {
    const { r, file } = await one(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(!existsSync(file));
  }
  const ok = await one([PHRASES.retention, PHRASES.acceptance, PHRASES.skip, PHRASES.yes]);
  assert.equal(ok.r.ok, true, ok.r.message);
  const c = readConsentFile(ok.file);
  assert.equal(c.stage, "one-prod");
  assert.equal(c.acks.retention, true);
  assert.equal(c.acks.acceptance, true);
  assert.deepEqual(c.acks.previousStage, { reviewed: false, run: null, skipped: true, stagesSkipped: ["nonprod"] });
});

test("a typed CRLF line ending from a Windows terminal does not defeat an exact answer, and nothing else is trimmed", async () => {
  const ok = await go({ answers: [`${PHRASES.yes}\r`] });
  assert.equal(ok.r.ok, true, ok.r.message);
  const bad = await go({ answers: [`${PHRASES.yes} `] });
  assert.equal(bad.r.ok, false);
});

test("a previous stage that ran is looked up and cited; none found means a skip acknowledgment, recorded", async () => {
  const ctx = consentCtx();
  const first = await go({ ctx, args: baseArgs({ runId: "np1" }), answers: [PHRASES.yes] });
  assert.equal(first.r.ok, true, first.r.message);
  // a nonprod consent without a collected manifest is not "a stage that ran"
  const lone = await go({ ctx, args: baseArgs({ runId: "p0", stage: "one-prod", expectedSubs: "1", subscriptions: SUB1 }), transport: consentTransport({ accounts: [sub(SUB1, "prod")] }), answers: [PHRASES.retention, PHRASES.acceptance, PHRASES.previous, PHRASES.yes] });
  assert.equal(lone.r.ok, false, "PREVIOUS STAGE REVIEWED is offered only when a previous run is found");
  // make np1 look like a run that collected
  writeJson(join(ctx.cwd, "waf-review", "np1", "collected", "manifest.json"), { schema: "waf-manifest/1", checks: {} });
  const ok = await go({ ctx, args: baseArgs({ runId: "p1", stage: "one-prod", expectedSubs: "1", subscriptions: SUB1 }), transport: consentTransport({ accounts: [sub(SUB1, "prod")] }), answers: [PHRASES.retention, PHRASES.acceptance, PHRASES.previous, PHRASES.yes] });
  assert.equal(ok.r.ok, true, ok.r.message);
  assert.match(ok.io.text(), /np1/);
  assert.deepEqual(readConsentFile(ok.file).acks.previousStage, { reviewed: true, run: "np1", skipped: false, stagesSkipped: [] });
  // root-mg after only a nonprod run: one-prod was skipped
  const root = await go({ ctx, args: { runId: "rm1", stage: "root-mg", expectedSubs: "2", managementGroup: "mg-root", redact: "default" }, answers: [PHRASES.retention, PHRASES.acceptance, PHRASES.previous, PHRASES.yes] });
  assert.equal(root.r.ok, false, "one-prod never ran, so only the skip phrase is offered");
});

test("a forged consent.json of a previous stage is not cited", async () => {
  const ctx = consentCtx();
  writeJson(join(ctx.cwd, "waf-review", "fake", "consent.json"), { schema: "waf-consent/1", runId: "fake", stage: "nonprod" });
  writeJson(join(ctx.cwd, "waf-review", "fake", "collected", "manifest.json"), { checks: {} });
  const { r } = await go({ ctx, args: baseArgs({ runId: "p1", stage: "one-prod", expectedSubs: "1", subscriptions: SUB1 }), transport: consentTransport({ accounts: [sub(SUB1, "prod")] }), answers: [PHRASES.retention, PHRASES.acceptance, PHRASES.previous, PHRASES.yes] });
  assert.equal(r.ok, false);
});

test("the stage and the budget come from the user's flags only and are recorded", async () => {
  const { r, file } = await go({ args: baseArgs({ queryBudget: "1500", redact: "strict" }) });
  assert.equal(r.ok, true, r.message);
  const c = readConsentFile(file);
  assert.equal(c.queryBudget, 1500);
  assert.equal(c.stage, "nonprod");
  assert.equal(c.redact, "strict");
  assert.equal((await go({})).r.ok && readConsentFile((await go({})).file).queryBudget, 6000);
});

// ------------------------------------------------------------------------------------------------ output folder
test("a run folder under /mnt/ or in OneDrive needs a typed acknowledgment, recorded", async () => {
  for (const cwdReal of ["/mnt/c/Users/x/work", "/home/u/OneDrive/work", "/home/u/OneDrive - Contoso/work"]) {
    const no = await go({ ctx: consentCtx({ cwdReal }), answers: ["no"] });
    assert.equal(no.r.ok, false, cwdReal);
    const ok = await go({ ctx: consentCtx({ cwdReal }), answers: [PHRASES.folder, PHRASES.yes] });
    assert.equal(ok.r.ok, true, `${cwdReal}: ${ok.r.message}`);
    const c = readConsentFile(ok.file);
    assert.equal(c.acks.outputFolder, true);
    assert.ok(c.outputFolder.problem);
  }
});

// ------------------------------------------------------------------------------------------------ the file
test("consent.json holds the hash of the exact text shown, the stage, the counts and the UTC time, and is derivable from its own fields", async () => {
  const { r, io, file } = await go();
  assert.equal(r.ok, true, r.message);
  const c = readConsentFile(file);
  assert.equal(c.schema, "waf-consent/1");
  assert.equal(c.runId, "r1");
  assert.equal(c.createdAt, "2026-11-25T12:00:00.000Z");
  assert.equal(c.expectedSubs, 2);
  assert.equal(c.readSubs, 2);
  assert.equal(c.mcp, "not-used");
  assert.match(c.textSha256, /^[0-9a-f]{64}$/);
  assert.equal(c.storedTextSha256, sha256(c.storedText));
  assert.equal(c.textSha256, c.storedTextSha256, "in the default mode the stored text is the text shown");
  assert.equal(c.textSha256, sha256(io.shownScreen), "the hash is of the exact text printed to the terminal");
  const { consentProblems } = await lib();
  assert.deepEqual(consentProblems(c, { runId: "r1" }), []);
  if (posix) assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("the screen carries the tenant's last four characters, the identity type, the role, the az path, the profile, the stage, both counts, the MCP status and the provider statement", async () => {
  const { io } = await go();
  const t = io.text();
  for (const re of [new RegExp(TENANT.slice(-4)), /user/, /Reader/, /Security Reader/, /\/usr\/bin\/az/, /isolated/i, /nonprod/, /expected.*2/i, /read.*2/i, /MCP.*not used/i, /model provider/i, /even when only the collector/i]) assert.match(t, re);
});

test("strict mode writes no subscription name to consent.json; the default mode does", async () => {
  const strict = await go({ args: baseArgs({ redact: "strict" }), transport: consentTransport({ accounts: [sub(SUB1, "client-secret-name-prod"), sub(SUB2, "client-secret-name-dev")] }) });
  assert.equal(strict.r.ok, true);
  assert.ok(!readFileSync(strict.file, "utf8").includes("client-secret-name"));
  assert.match(strict.io.text(), /client-secret-name-prod/, "the user still sees the real names");
  const plain = await go({ transport: consentTransport({ accounts: [sub(SUB1, "client-secret-name-prod"), sub(SUB2, "client-secret-name-dev")] }) });
  assert.match(readFileSync(plain.file, "utf8"), /client-secret-name-prod/);
  const { consentProblems } = await lib();
  assert.deepEqual(consentProblems(readConsentFile(strict.file), { runId: "r1" }), []);
});

test("consent never overwrites: a second run with the same id is refused", async () => {
  const ctx = consentCtx();
  assert.equal((await go({ ctx })).r.ok, true);
  const again = await go({ ctx });
  assert.equal(again.r.ok, false);
  assert.match(again.r.message, /already/i);
});

test("a refusal leaves no run folder behind", async () => {
  const ctx = consentCtx();
  const { r } = await go({ ctx, args: baseArgs({ expectedSubs: "3" }) });
  assert.equal(r.ok, false);
  assert.ok(!existsSync(join(ctx.cwd, "waf-review", "r1")));
});

// ------------------------------------------------------------------------------------------------ the command line
test("the command refuses to run without a terminal: piped answers cannot consent for the user", () => {
  const cwd = tmp();
  const r = run(["consent", "--run-id", "r1", "--stage", "nonprod", "--expected-subs", "2", "--subscriptions", `${SUB1},${SUB2}`], { cwd, input: "yes\n" });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /terminal|TTY/i);
  assert.ok(!existsSync(join(cwd, "waf-review", "r1", "consent.json")));
});

test("there is no --yes, no --force and no way to pass the stage, the scope or the budget to plan or collect", () => {
  const cwd = tmp();
  for (const args of [["consent", "--yes"], ["consent", "--force"], ["plan", "--run-id", "r1", "--stage", "root-mg"], ["plan", "--run-id", "r1", "--expected-subs", "3"], ["plan", "--run-id", "r1", "--query-budget", "99"], ["plan", "--run-id", "r1", "--subscriptions", SUB1], ["plan", "--run-id", "r1", "--management-group", "x"], ["collect", "--run", "r1", "--stage", "nonprod"], ["collect", "--run", "r1", "--query-budget", "99"], ["collect", "--run", "r1", "--subscriptions", SUB1]]) {
    const r = run(args, { cwd });
    assert.equal(r.code, 2, `${args.join(" ")}: ${r.out}`);
  }
});

test("--help lists the new commands and says consent runs in the user's terminal", () => {
  const r = run(["--help"], { cwd: tmp() });
  for (const c of ["consent", "cap-check", "render", "reverify", "purge"]) assert.match(r.stdout, new RegExp(c));
  assert.match(r.stdout, /user'?s? (own )?terminal/i);
  assert.ok(!/not in this build/.test(r.stdout.replace(/topology[^\n]*/g, "")));
});
