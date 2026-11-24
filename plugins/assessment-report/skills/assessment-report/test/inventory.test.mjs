import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { matchGlob } from "../scripts/lib/glob.mjs";
import { buildInventory } from "../scripts/lib/inventory.mjs";
import { scanString } from "../scripts/lib/secrets.mjs";
import { FIXTURE_REPO, fakeSecret, repoCopy, tmp } from "./helpers.mjs";

// Words that look like credentials are assembled from parts, so no line of this file reads as a secret assignment.
const cat = (...parts) => parts.join("");
const PW = cat("pass", "word");
const SEC = cat("sec", "ret");
const TOK = cat("to", "ken");
const KEY = cat("api", "_", "key");
const AKEY = cat("access", "_", "key");
const CSEC = cat("client", "_", SEC);
const BEARER = cat("Bear", "er");
const DOLLAR = "$";
const addr = (...p) => p.join(".");

const GOLDEN = fileURLToPath(new URL("./golden/inventory.json", import.meta.url));

test("inventory of the synthetic repository matches the golden file", () => {
  const inv = buildInventory(FIXTURE_REPO, {});
  const text = `${JSON.stringify(inv, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, text);
  assert.equal(text, readFileSync(GOLDEN, "utf8"), "run with UPDATE_GOLDEN=1 to refresh after an intended change");
  assert.deepEqual(inv.files.map((f) => f.path), ["docs/notas.md", "docs/runbook.md", "infra/main.tf", "infra/variables.tf", "pipelines/deploy.yml", "src/app.js"]);
  assert.equal(inv.revisionKind, "inventory-hash");
});

test("inventory leaves out .git, node_modules, binary, oversized and out-of-scope files, with reasons", () => {
  const repo = repoCopy();
  mkdirSync(join(repo, "node_modules", "x"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "x", "index.js"), "x");
  mkdirSync(join(repo, ".git"));
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(repo, "logo.png"), Buffer.from([137, 80, 78, 71, 0, 0, 0]));
  writeFileSync(join(repo, "big.log"), "x".repeat(5000));
  const outside = tmp("outside-");
  writeFileSync(join(outside, "o.txt"), "outside");
  try {
    symlinkSync(join(outside, "o.txt"), join(repo, "o.txt"));
  } catch {
    // symlinks unavailable on this platform
  }
  const inv = buildInventory(repo, { maxBytes: 4000, scopeOut: ["docs/**"] });
  const reasons = Object.fromEntries(inv.exclusions.map((e) => [e.path, e.reason]));
  assert.equal(reasons["node_modules/"], "dependencies");
  assert.equal(reasons[".git/"], "git-metadata");
  assert.equal(reasons["logo.png"], "not-text");
  assert.equal(reasons["big.log"], "too-large");
  assert.equal(reasons["docs/runbook.md"], "out-of-scope");
  if (reasons["o.txt"]) assert.equal(reasons["o.txt"], "symlink-outside-root");
  assert.ok(!inv.files.some((f) => /^(node_modules|\.git|docs)\//.test(f.path)));
});

test("the git revision is read from .git without running git", () => {
  const repo = repoCopy();
  mkdirSync(join(repo, ".git", "refs", "heads"), { recursive: true });
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(repo, ".git", "refs", "heads", "main"), `${"ab12".repeat(10)}\n`);
  const inv = buildInventory(repo, {});
  assert.equal(inv.revision, "ab12".repeat(10));
  assert.equal(inv.revisionKind, "git-commit");
});

test("glob: *, ** and ? only; a pattern without a slash matches at any depth", () => {
  assert.ok(matchGlob("infra/**/*.tf", "infra/a/b/main.tf"));
  assert.ok(matchGlob("infra/**/*.tf", "infra/main.tf"));
  assert.ok(!matchGlob("infra/*.tf", "infra/a/main.tf"));
  assert.ok(matchGlob("*.tf", "infra/deep/main.tf"));
  assert.ok(matchGlob("main.t?", "infra/main.tf"));
  assert.ok(!matchGlob("infra/**/*.tf", "other/main.tf"));
  assert.ok(matchGlob("docs/**", "docs/a/b.md"));
  assert.ok(!matchGlob("a.b", "aXb"), "a dot is a dot");
});

test("secret scanner: finds common shapes and ignores references and placeholders", () => {
  assert.deepEqual(scanString(fakeSecret.privateKeyHeader()), ["private-key"]);
  assert.deepEqual(scanString(fakeSecret.awsKey()), ["aws-access-key"]);
  assert.deepEqual(scanString(fakeSecret.githubToken()), ["github-token"]);
  assert.deepEqual(scanString(fakeSecret.generic()), ["generic-credential"]);
  for (const ok of [`${PW} = var.db_${PW}`, `${PW}: "${DOLLAR}{DB_${PW.toUpperCase()}}"`, `${TOK} = <your ${TOK}>`, "Senhas rotacionadas a cada 90 dias.", `${SEC}_name = "app-${SEC}"`, `${KEY}: changeme`])
    assert.deepEqual(scanString(ok), [], ok);
});

// ---- more secret shapes (review cycle 1, I2). Every value is assembled at run time from short parts. ----------
const j = (...p) => p.join("");
const SHAPES = [
  ["url-credential", j("postgres://admin", ":", "S3cr3t", "Passw0rd", "@db.example.com/app")],
  ["url-credential", j("mongodb+srv://svc", ":", "pa55word", "@cluster0.example.net")],
  ["azure-storage-key", j("DefaultEndpointsProtocol=https;AccountName=st;", "AccountKey", "=", "Zm9vYmFy", "YmF6cXV4", "Zm9vYmFy", "YmF6cXV4", "Zm9vYg", "==;")],
  ["bearer-token", j("Authorization: ", "Bearer", " ", "0123456789", "abcdef0123", "456789abcd", "ef")],
  ["sas-signature", j("https://st.blob.core.windows.net/c?sv=2022-11-02&", "sig", "=", "Ab3dE6gH9", "jK2mN5pQ8", "sT1vW4yZ")],
  ["generic-credential", j("pass", "word", " = ", '"', "hunt", "er2", '"')],
  ["generic-credential", j("pass", "word", " = ", '"', "correct", "horse", "battery", "staple", '"')],
  ["generic-credential", j("client", "_", "secret", ": ", "abcd", "efgh")],
  ["generic-credential", j("export DB_", "PASS", "WORD", "=", "swordfish")],
];
for (const [kind, text] of SHAPES)
  test(`secret shape detected: ${kind} (${text.slice(0, 18)}...)`, () => {
    assert.ok(scanString(text).includes(kind), `${kind} not found in a ${text.length}-char string`);
  });

test("references, placeholders and ordinary configuration are not flagged as secrets", () => {
  for (const ok of [
    `id-${TOK}: write`, "permissions:\n  contents: read", `${PW}: var.db_${PW}`, `${TOK}: ${DOLLAR}{{ ${SEC}s.GITHUB_${TOK.toUpperCase()} }}`,
    cat("postgres://admin", ":", DOLLAR, "{DB_PASS}", "@db.example.com/app"), cat("postgres://admin", ":<", PW, ">", "@host/app"), "https://user@example.com/path",
    `Authorization: ${BEARER} <${TOK}>`, `${SEC}_name = "app-${SEC}"`, 'key = "terraform.tfstate"', `${PW}: changeme`, `${PW} = "<your ${PW}>"`,
    `${cat("s", "ig")}=short`, `${TOK}_endpoint: https://login.example.com`, `${BEARER} ${TOK}s are described in the policy`,
  ])
    assert.deepEqual(scanString(ok), [], ok);
});

test("false positives are measured: no fixture, golden file or reference trips the scanner", () => {
  const roots = [join(FIXTURE_REPO, ".."), fileURLToPath(new URL("../evals/cases", import.meta.url)), fileURLToPath(new URL("../references", import.meta.url)), fileURLToPath(new URL("./golden", import.meta.url)),
    fileURLToPath(new URL("../../../../azure-terraform-stacks/skills/azure-terraform-stacks/test/golden", import.meta.url))];
  const hits = [];
  let files = 0;
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else {
        let t;
        try { t = readFileSync(p, "utf8"); } catch { continue; }
        files++;
        t.split("\n").forEach((l, i) => { if (scanString(l).length) hits.push(`${p}:${i + 1}`); });
      }
    }
  };
  for (const r of roots) if (existsSync(r)) walk(r);
  assert.ok(files > 100, `only ${files} files scanned`);
  assert.deepEqual(hits, []);
});

// ---- Terraform and YAML references are not secrets (review cycle 2, I-1) ---------------------------------------
test("resource addresses, YAML tags and schema words are not flagged", () => {
  for (const ok of [
    `administrator_${PW} = ${addr("random_" + PW, "pg", "result")}`,
    `admin_${PW} = ${addr("azurerm_key_vault_" + SEC, "pg", "value")}`,
    `${CSEC} = ${addr("azuread_application_" + PW, "app", "value")}`,
    `storage_account_${AKEY} = ${addr("azurerm_storage_account", "x", "primary_" + AKEY)}`,
    `${PW} = ${addr("random_" + PW, "db", "result")}`,
    `auth_${TOK}: required`,
    `${PW}: !vault |`,
    `${PW}: !!str`,
    `${TOK}: *shared_${TOK}`,
    `${SEC}: optional`,
    `${PW} = ${addr("random_" + PW, "db[0]", "result")}`,
    `${PW} = ${addr("azurerm_key_vault_" + SEC, "pw", "id")}`,
    `${PW} = ${addr("module", "a", "b", "c")}`,
    `${PW} = ${addr("data", "x", "y", "z")}`,
    `${PW}: |`,
    `${PW}: >-`,
    `${PW}: |2`,
    `${PW}: &anchor_name`,
  ])
    assert.deepEqual(scanString(ok), [], ok);
});

test("short values and plain literals are still detected after the reference exclusions", () => {
  const j2 = (...p) => p.join("");
  for (const bad of [
    j2("pass", "word", " = ", '"', "hunt", "er2", '"'),
    j2("pass", "word", ": ", "correct", "horse", "battery"),
    j2("postgres://us", "er", ":", "pa", "ss", "@host/db"),
    j2("pass", "word", " = ", '"', "random_password", ".", "db", ".", "result", '"'),
  ])
    assert.ok(scanString(bad).length > 0, bad.slice(0, 12));
});

// ---- no credential-looking literal in the files this change adds (review cycle 2, GitGuardian) ---------------
test("no file of this change holds a credential-looking literal (build values at run time)", () => {
  const root = fileURLToPath(new URL("../../../../..", import.meta.url));
  const places = [fileURLToPath(new URL("..", import.meta.url)), join(root, "evals"), join(root, "openspec", "changes", "add-assessment-report-skill")];
  // the same shapes a secret scanner looks for in a line of any file, regardless of what the value is
  const shape = new RegExp(
    [`(?:pass(?:word|wd)|${SEC}|${TOK}|api[_-]?key|access[_-]?key|account[_-]?key|sharedaccesskey)["']?\\s*[:=]\\s*["']?[^\\s"']{3,}`, "://[^\\s\"'/]+:[^\\s\"'@]{3,}@", "Bearer\\s+[A-Za-z0-9]", "[?&]sig=[^\\s]"].join("|"),
    "i",
  );
  // allowed on purpose: the marker, a reference, a placeholder, a JSON key of the answer keys, and the scanner's own source
  const allowed = (line, file) => /\{\{FAKE_SECRET\}\}|var\.db_admin_|changeme|"fakeSecret"|fakeSecret\b/.test(line) || file.endsWith(join("scripts", "lib", "secrets.mjs")) || (file.endsWith("inventory.test.mjs") && line.includes("sharedaccesskey"));
  const hits = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n === ".git") continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else {
        let t;
        try { t = readFileSync(p, "utf8"); } catch { continue; }
        t.split("\n").forEach((l, i) => { if (shape.test(l) && !allowed(l, p)) hits.push(`${p.slice(root.length)}:${i + 1}`); });
      }
    }
  };
  for (const d of places) walk(d);
  assert.deepEqual(hits, [], "build such values at run time from parts (see cat() in this file and evals/fake-secret.mjs)");
});

// ---- an unquoted value that only looks like a reference or a YAML marker is still a secret (review cycle 3, R-1) ----
test("dotted words and values that start with ! & * | > are flagged: they are passwords, not references", () => {
  const dotted = [
    `${PW} = ${addr("Summer", "Winter", "2025")}`,
    `${CSEC}: ${addr("my", "real", SEC)}`,
    `${PW} = ${addr("Sup3r", "S3cret", "Pass")}`,
    `${SEC} = ${addr("prod", "db", "passw0rd")}`,
    `${TOK} = ${addr("a", "b", "c")}`,
    `${PW} = ${addr("prod_db", "passw0rd")}`,
  ];
  const marked = [
    `${PW} = !Passw0rd123`,
    `${PW} = *Hunter2Hunter2`,
    `${PW}: |hunter2pass`,
    `${PW}: >hunter2pass`,
    `${PW} = &Abc12345`,
    `${PW} = !Hunter2!`,
    `${PW} = "hunter2"`,
  ];
  for (const bad of [...dotted, ...marked]) assert.ok(scanString(bad).length > 0, `not flagged: ${bad.replace(/=.*/, "=...").replace(/:.*/, ": ...")}`);
});

test("a secret on one line of a multi-line text is flagged next to a harmless block indicator", () => {
  assert.ok(scanString(`${PW}: |\n  text\n${TOK}: ${cat("Hunt", "er2", "pass")}`).length > 0);
  assert.deepEqual(scanString(`${PW}: |\n  text`), []);
});
