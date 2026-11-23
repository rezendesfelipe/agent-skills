import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { matchGlob } from "../scripts/lib/glob.mjs";
import { buildInventory } from "../scripts/lib/inventory.mjs";
import { scanString } from "../scripts/lib/secrets.mjs";
import { FIXTURE_REPO, fakeSecret, repoCopy, tmp } from "./helpers.mjs";

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
  for (const ok of ['password = var.db_password', 'password: "${DB_PASSWORD}"', "token = <your token>", "Senhas rotacionadas a cada 90 dias.", 'secret_name = "app-secret"', "api_key: changeme"])
    assert.deepEqual(scanString(ok), [], ok);
});
