import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildInventory } from "../scripts/lib/inventory.mjs";
import { FAILURE_CODES, verifyAssessment } from "../scripts/lib/verify.mjs";
import { sha256 } from "../scripts/lib/util.mjs";
import { edit, fakeSecret, file, finding, rationale, readJson, repoCopy, run, startRun, tmp } from "./helpers.mjs";

const NO_NET = fileURLToPath(new URL("./no-network.mjs", import.meta.url));

/** Verifies evidence items against a repository copy, with an inventory taken now. */
function verifyEvidence(items, { repo = repoCopy(), maxBytes, inventory = true, outDir = tmp(), captures = null } = {}) {
  const inv = inventory ? buildInventory(repo, {}) : null;
  const r = verifyAssessment({ evidence: items, findings: [] }, { root: repo, outDir, inventory: inv, captures, maxBytes });
  return Object.fromEntries(r.results.map((x) => [x.evidence, x]));
}
const TLS_LINE = '  min_tls_version          = "TLS1_0"';

test("file evidence passes when the quote equals the cited lines, and records the excerpt hash", () => {
  const r = verifyEvidence([file("E-001", "infra/main.tf", 11, 12, `${TLS_LINE}\n  public_network_access_enabled = true`)]);
  assert.equal(r["E-001"].status, "pass");
  assert.equal(r["E-001"].excerptSha256, sha256(`${TLS_LINE}\n  public_network_access_enabled = true`));
  assert.equal(r["E-001"].location, "infra/main.tf:11-12");
});

test("CRLF files, trailing whitespace and Unicode normalization pass", () => {
  const repo = repoCopy();
  const r = verifyEvidence([
    file("E-001", "src/app.js", 1, 3, "export function total(items) {\n  return items.reduce((a, b) => a + b.price, 0);\n}"),
    file("E-002", "infra/main.tf", 11, 11, `${TLS_LINE}   `),
    file("E-003", "docs/notas.md", 3, 3, "Revisão trimestral — ação obrigatória para o time de operações.".normalize("NFD")),
  ], { repo });
  for (const id of ["E-001", "E-002", "E-003"]) assert.equal(r[id].status, "pass", `${id}: ${r[id].message}`);
});

test("path-escape: parent folder, absolute path, .git and a symlink out of the root", (t) => {
  const repo = repoCopy();
  const outside = tmp("outside-");
  writeFileSync(join(outside, "secrets.txt"), "top secret\n");
  mkdirSync(join(repo, ".git"));
  writeFileSync(join(repo, ".git", "config"), "[core]\n");
  let linked = true;
  try {
    symlinkSync(join(outside, "secrets.txt"), join(repo, "link.txt"));
  } catch {
    linked = false;
    t.diagnostic("symlinks are not available; the symlink case was skipped");
  }
  const items = [
    file("E-001", "../secrets.txt", 1, 1, "top secret"),
    file("E-002", join(outside, "secrets.txt"), 1, 1, "top secret"),
    file("E-003", ".git/config", 1, 1, "[core]"),
    ...(linked ? [file("E-004", "link.txt", 1, 1, "top secret")] : []),
  ];
  const r = verifyEvidence(items, { repo });
  for (const it of items) {
    assert.equal(r[it.id].code, "path-escape", `${it.id}: ${r[it.id].message}`);
    assert.ok(!JSON.stringify(r[it.id]).includes("top secret"), "nothing outside the root was read into the result");
  }
});

test("not-found, not-text, too-large and range-invalid", () => {
  const repo = repoCopy();
  writeFileSync(join(repo, "blob.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
  writeFileSync(join(repo, "big.txt"), "x".repeat(3000));
  writeFileSync(join(repo, "thirty.txt"), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"));
  const r = verifyEvidence([
    file("E-001", "infra/missing.tf", 1, 1, "x"),
    file("E-002", "blob.bin", 1, 1, "x"),
    file("E-003", "big.txt", 1, 1, "x"),
    file("E-004", "infra/main.tf", 99, 100, "x"),
    file("E-005", "thirty.txt", 1, 21, "x"),
    file("E-006", "infra/main.tf", 5, 4, "x"),
  ], { repo, maxBytes: 2000 });
  assert.equal(r["E-001"].code, "not-found");
  assert.equal(r["E-002"].code, "not-text");
  assert.equal(r["E-003"].code, "too-large");
  assert.equal(r["E-004"].code, "range-invalid");
  assert.equal(r["E-005"].code, "range-invalid");
  assert.match(r["E-005"].message, /limit is 20/);
  assert.equal(r["E-006"].code, "range-invalid");
});

test("quote-mismatch shows the cited lines and where the quote really is (drifted line numbers)", () => {
  const r = verifyEvidence([file("E-001", "infra/main.tf", 12, 12, TLS_LINE), file("E-002", "infra/main.tf", 11, 11, "this text is nowhere")]);
  assert.equal(r["E-001"].code, "quote-mismatch");
  assert.match(r["E-001"].message, /public_network_access_enabled/, "shows what the cited lines say");
  assert.match(r["E-001"].message, /appears at lines 11-11/);
  assert.match(r["E-002"].message, /does not appear in the file/);
});

test("drift: the file changed after the inventory", () => {
  const repo = repoCopy();
  const inv = buildInventory(repo, {});
  appendFileSync(join(repo, "infra", "main.tf"), "# changed later\n");
  const r = verifyAssessment({ evidence: [file("E-001", "infra/main.tf", 11, 11, TLS_LINE)], findings: [] }, { root: repo, outDir: tmp(), inventory: inv });
  assert.equal(r.results[0].code, "drift");
  assert.match(r.results[0].message, /changed since the inventory/);
});

test("absence: pass, absence-violated with the first matches, scope-empty, pattern-too-costly", () => {
  const r = verifyEvidence([
    { id: "E-001", kind: "absence", scope: ["infra/**/*.tf"], pattern: "encryption" },
    { id: "E-002", kind: "absence", scope: ["infra/**/*.tf"], pattern: "min_tls_version" },
    { id: "E-003", kind: "absence", scope: ["nothing/**"], pattern: "x" },
    { id: "E-004", kind: "absence", scope: ["**/*.tf"], pattern: "(a+)+$" },
    { id: "E-005", kind: "absence", scope: ["**/*.tf"], pattern: "(" },
    { id: "E-006", kind: "absence", scope: ["*.tf"], pattern: "ENCRYPTION", flags: "i" },
  ]);
  assert.equal(r["E-001"].status, "pass");
  assert.match(r["E-001"].message, /not found in 2 file/);
  assert.equal(r["E-002"].code, "absence-violated");
  assert.match(r["E-002"].matches[0], /^infra\/main\.tf:11: min_tls_version/);
  assert.equal(r["E-003"].code, "scope-empty");
  assert.equal(r["E-004"].code, "pattern-too-costly");
  assert.equal(r["E-005"].code, "pattern-too-costly");
  assert.equal(r["E-006"].status, "pass", "a pattern without a slash matches at any depth: *.tf covers infra/*.tf");
});

test("document evidence is checked as a file, and a non-text document is refused", () => {
  const repo = repoCopy();
  writeFileSync(join(repo, "plan.pdf"), Buffer.from("%PDF-1.4\n\u0000\u0000binary"));
  const r = verifyEvidence([
    { id: "E-001", kind: "document", path: "docs/runbook.md", startLine: 5, endLine: 5, quote: "Rollback is manual: re-run the previous commit.", source: "Runbook" },
    { id: "E-002", kind: "document", path: "plan.pdf", startLine: 1, endLine: 1, quote: "x", source: "Plan" },
  ], { repo });
  assert.equal(r["E-001"].status, "pass");
  assert.equal(r["E-002"].code, "not-text");
});

test("a statement and a url without a snapshot are recorded as not machine-checked and never fetched", () => {
  const { out } = startRun();
  edit(out, (a) => {
    a.evidence.push({ id: "E-001", kind: "statement", source: "CTO", date: "2026-11-10", text: "Backups are tested yearly." });
    a.evidence.push({ id: "E-002", kind: "url", url: "https://example.com/policy", accessed: "2026-11-12", quote: "Backups are tested." });
    a.findings.push(finding("F-001", ["E-001", "E-002"], { impact: "moderate", likelihood: "possible", effort: "M", rationale }));
  });
  const r = run(["verify", "--out", out], { env: { NODE_OPTIONS: `--import ${NO_NET}` } });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /NETWORK-OR-PROCESS/);
  const v = readJson(join(out, "assessment.json")).verification.results;
  assert.deepEqual(v.map((x) => [x.evidence, x.status, x.machineChecked]), [["E-001", "unchecked", false], ["E-002", "unchecked", false]]);
  assert.match(r.out, /2 not machine-checked/);
});

test("the whole engine runs with the network and child processes disabled", () => {
  const { out } = startRun([], );
  const r = run(["status", "--out", out], { env: { NODE_OPTIONS: `--import ${NO_NET}` } });
  assert.equal(r.code, 0, r.out);
});

test("a url with a snapshot is verified as a file; output evidence needs a matching capture", () => {
  const { out } = startRun();
  mkdirSync(join(out, "evidence"), { recursive: true });
  writeFileSync(join(out, "evidence", "policy.txt"), "Backups are tested yearly.\nRestores are not tested.\n");
  writeFileSync(join(out, "evidence", "az-list.txt"), "name   sku\nstlogs  Standard_LRS\n");
  assert.equal(run(["capture", "--file", "evidence/az-list.txt", "--command", "az storage account list", "--out", out]).code, 0);
  edit(out, (a) => {
    a.evidence.push({ id: "E-001", kind: "url", url: "https://example.com/policy", accessed: "2026-11-12", snapshot: "evidence/policy.txt", startLine: 2, endLine: 2, quote: "Restores are not tested." });
    a.evidence.push({ id: "E-002", kind: "output", path: "evidence/az-list.txt", command: "az storage account list", capturedAt: "2026-11-12T10:00:00Z", quote: "stlogs  Standard_LRS" });
    a.findings.push(finding("F-001", ["E-001", "E-002"], { impact: "moderate", likelihood: "possible", effort: "M", rationale }));
  });
  let r = run(["verify", "--out", out]);
  assert.equal(r.code, 0, r.out);
  // the saved output changes after capture
  appendFileSync(join(out, "evidence", "az-list.txt"), "extra\n");
  edit(out, () => {});
  r = run(["verify", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /E-002 \[drift\]/);
});

test("secrets: a quote with a private key header fails with secret-in-quote; redacted evidence passes", () => {
  const repo = repoCopy();
  writeFileSync(join(repo, "infra", "key.pem"), `${fakeSecret.privateKeyHeader()}\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----\n`);
  writeFileSync(join(repo, "infra", "settings.tfvars"), `${fakeSecret.generic()}\n`);
  const r = verifyEvidence([
    file("E-001", "infra/key.pem", 1, 1, fakeSecret.privateKeyHeader()),
    file("E-002", "infra/key.pem", 1, 3, undefined, { redacted: true, secretKind: "private-key" }),
    file("E-003", "infra/key.pem", 1, 3, undefined, { redacted: true, secretKind: "aws-access-key" }),
    file("E-004", "infra/key.pem", 1, 1, fakeSecret.privateKeyHeader(), { redacted: true, secretKind: "private-key" }),
    file("E-005", "infra/settings.tfvars", 1, 1, undefined, { redacted: true, secretKind: "generic-credential" }),
    file("E-006", "infra/settings.tfvars", 1, 1, fakeSecret.generic()),
  ], { repo });
  assert.equal(r["E-001"].code, "secret-in-quote");
  assert.equal(r["E-002"].status, "pass");
  assert.match(r["E-002"].message, /redacted private-key/);
  assert.equal(r["E-003"].code, "quote-mismatch");
  assert.equal(r["E-004"].code, "secret-in-quote");
  assert.equal(r["E-005"].status, "pass");
  assert.equal(r["E-006"].code, "secret-in-quote");
  assert.ok(!JSON.stringify(r).includes("Zx9fQ2mK7vLp4Rt8Wy3N"), "the secret value never reaches the verification result");
});

test("a secret in a free-text field is a problem; a secret in the file never leaks through a mismatch message", () => {
  const repo = repoCopy();
  writeFileSync(join(repo, "infra", "settings.tfvars"), `${fakeSecret.generic()}\n`);
  const inv = buildInventory(repo, {});
  const a = {
    evidence: [file("E-001", "infra/settings.tfvars", 1, 1, "something else")],
    findings: [finding("F-001", ["E-001"], { statement: `The token is ${fakeSecret.githubToken()}.` })],
  };
  const r = verifyAssessment(a, { root: repo, outDir: tmp(), inventory: inv });
  assert.equal(r.results[0].code, "quote-mismatch");
  assert.match(r.results[0].message, /withheld/);
  assert.ok(r.problems.some((p) => p.code === "secret-in-quote" && p.where === "findings[0].statement"));
  assert.ok(!JSON.stringify(r).includes(fakeSecret.githubToken()));
});

test("every failure code of the spec has a verifier case in this suite", () => {
  const src = readJson(fileURLToPath(new URL("../package.json", import.meta.url)));
  assert.equal(src.dependencies, undefined);
  assert.deepEqual([...FAILURE_CODES].sort(), ["absence-violated", "drift", "not-found", "not-text", "path-escape", "pattern-too-costly", "quote-mismatch", "range-invalid", "scope-empty", "secret-in-quote", "too-large"]);
});

// ---- the verify / repair / demote cycle, through the CLI -----------------------------------------------
function setupBroken() {
  const { out } = startRun();
  edit(out, (a) => {
    a.evidence.push(file("E-001", "infra/main.tf", 11, 11, TLS_LINE));
    a.evidence.push(file("E-002", "infra/main.tf", 3, 3, "this line does not exist"));
    a.evidence.push(file("E-003", "infra/variables.tf", 1, 1, "variable \"nothing\" {"));
    a.findings.push(finding("F-001", ["E-001", "E-002"], { impact: "high", likelihood: "likely", effort: "S", rationale }));
    a.findings.push(finding("F-002", ["E-003"], { impact: "severe", likelihood: "likely", effort: "M", rationale, potentialSeverity: "Critical" }));
    a.findings.push(finding("F-003", [], { impact: "high", likelihood: "possible", effort: "M", rationale }));
  });
  return out;
}
const state = (out) => readJson(join(out, ".state", "run.json"));

test("verify exits 1 on failures, allows two repairs, then demotes by code and continues to classify", () => {
  const out = setupBroken();
  let r = run(["verify", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /E-002 \[quote-mismatch\]/);
  assert.match(r.out, /E-003 \[quote-mismatch\]/);
  assert.match(r.out, /F-003 lists no evidence/);
  assert.match(r.out, /Repair attempt 1 of 2/);
  assert.equal(state(out).current, "repair");
  assert.equal(run(["classify", "--out", out]).code, 1, "classify is refused while failures are unrepaired");
  r = run(["verify", "--out", out]);
  assert.match(r.out, /Repair attempt 2 of 2/);
  r = run(["verify", "--out", out]);
  assert.equal(r.code, 1, "evidence still fails, so the exit code stays 1");
  assert.match(r.out, /Repair limit reached: demoted by code: F-002, F-003/);
  assert.equal(state(out).current, "classify");
  r = run(["classify", "--out", out]);
  assert.equal(r.code, 0, r.out);
  const a = readJson(join(out, "assessment.json"));
  const by = Object.fromEntries(a.findings.map((f) => [f.id, f]));
  assert.equal(by["F-001"].confidence, "verified", "partial failure keeps the confidence of the passing item");
  assert.equal(by["F-001"].severity, "High");
  assert.deepEqual([by["F-002"].confidence, by["F-002"].severity], ["unverified", "n/a"]);
  assert.deepEqual([by["F-003"].confidence, by["F-003"].severity], ["unverified", "n/a"]);
  const gen = a.actions.filter((x) => x.generated === "collect-evidence");
  assert.deepEqual(gen.map((x) => [x.title, x.addresses[0], x.wave]), [["Collect evidence for F-002", "F-002", 1], ["Collect evidence for F-003", "F-003", 1]]);
  assert.ok(a.findings.length === 3 && a.evidence.length === 3, "nothing was deleted from the record");
  assert.equal(a.verification.results.filter((x) => x.status === "fail").length, 2, "failures stay in the verification log");
});

test("a hand-edited confidence or severity makes verify and check fail", () => {
  const { out } = startRun();
  edit(out, (a) => {
    a.evidence.push(file("E-001", "infra/main.tf", 3, 3, "wrong"));
    a.findings.push(finding("F-001", ["E-001"], { impact: "high", likelihood: "likely", effort: "S", rationale, confidence: "verified" }));
  });
  let r = run(["verify", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /computed-field-mismatch/);
  assert.match(r.out, /confidence is "verified" but the engine computes "unverified"/);

  // fix the evidence, classify, then tamper with the severity
  edit(out, (a) => {
    a.evidence[0] = file("E-001", "infra/main.tf", 11, 11, TLS_LINE);
    delete a.findings[0].confidence;
  });
  assert.equal(run(["verify", "--out", out]).code, 0);
  assert.equal(run(["classify", "--out", out]).code, 0);
  edit(out, (a) => (a.findings[0].severity = "Critical"));
  edit(out, (a) => a.actions.push({ id: "A-001", title: "Raise TLS", addresses: ["F-001"], wave: 1, effort: "S", risk: "low", dependsOn: [] }));
  r = run(["check", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /findings\[0\]\.severity/);
});
