// The closed `az` argument list, the child environment, the URL allowlist and the production transport
// (tasks 1.4, 1.5, 1.8; spec "Query allowlist", "Platforms"). `az` is never run: a stub executable stands in for it.
import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { AZ_READ_VECTORS, ALLOWED_ENV, azArgs, childEnv, isAllowedAzVector, isAllowedUrl } from "../scripts/lib/azread.mjs";
import { classifyAzPath, quoteWinArg, runBaseProblem } from "../scripts/lib/platform.mjs";
import { classifyAzError, createAzTransport } from "../scripts/lib/transport.mjs";
import { tmp } from "./helpers.mjs";

const GUID = "00000000-0000-0000-0000-000000000001";

test("the closed list holds exactly the documented vectors", () => {
  assert.deepEqual(AZ_READ_VECTORS.map((v) => v.join(" ")).sort(), [
    "az --version",
    "az account list --all",
    "az account list --all --output json",
    "az account show",
    "az account show --output json",
    "az ad signed-in-user show --query id --output tsv",
    "az ad sp show --id {guid} --query id --output tsv",
  ].sort());
});

test("a vector outside the list is refused, whatever its verb", () => {
  for (const v of [
    ["az", "account", "get-access-token"], ["az", "keyvault", "secret", "show", "--name", "x"], ["az", "webapp", "config", "appsettings", "list"],
    ["az", "functionapp", "config", "appsettings", "list"], ["az", "storage", "account", "keys", "list"], ["az", "acr", "credential", "show"],
    ["az", "account", "list"], ["az", "account", "list", "--all", "--debug"], ["az", "account", "show", "--verbose"], ["az", "account", "show", "extra"],
    ["az", "Account", "show"], ["az", "account", "show;", "id"], ["az"], [], ["az", "ad", "sp", "show", "--id", "not-a-guid", "--query", "id", "--output", "tsv"],
    ["az", "ad", "sp", "show", "--id", `${GUID}; x`, "--query", "id", "--output", "tsv"], ["/usr/bin/az", "account", "show"],
  ]) assert.equal(isAllowedAzVector(v), false, v.join(" "));
  for (const v of AZ_READ_VECTORS.filter((x) => !x.includes("{guid}"))) assert.equal(isAllowedAzVector(v), true);
  assert.equal(isAllowedAzVector(["az", "ad", "sp", "show", "--id", GUID, "--query", "id", "--output", "tsv"]), true);
});

test("azArgs adds --only-show-errors and refuses an unlisted vector", () => {
  assert.deepEqual(azArgs(["az", "account", "show"]), ["account", "show", "--only-show-errors"]);
  assert.throws(() => azArgs(["az", "account", "get-access-token"]), /closed list/);
});

test("child environment is exactly the allowlist", () => {
  const parent = { PATH: "/bin", HOME: "/h", AZURE_CONFIG_DIR: "/c", LANG: "C", LC_ALL: "C", TERM: "xterm", TMPDIR: "/t", ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y", AWS_SECRET_ACCESS_KEY: "z", GITHUB_TOKEN: "t", ARM_CLIENT_SECRET: "s", AZURE_CLIENT_SECRET: "s2", HTTPS_PROXY: "http://p", SSL_CERT_FILE: "/c.pem" };
  const env = childEnv(parent);
  for (const k of Object.keys(env)) assert.ok(ALLOWED_ENV.includes(k) || k === "AZURE_CORE_COLLECT_TELEMETRY", `unexpected ${k}`);
  assert.equal(env.AZURE_CORE_COLLECT_TELEMETRY, "false");
  assert.equal(env.HTTPS_PROXY, "http://p");
  assert.equal(env.SSL_CERT_FILE, "/c.pem");
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "ARM_CLIENT_SECRET", "AZURE_CLIENT_SECRET"]) assert.ok(!(k in env), k);
  assert.ok(!("HTTP_PROXY" in childEnv({ PATH: "/bin" })), "proxy variables only when already set");
});

test("URL allowlist: management.azure.com over https, nothing else", () => {
  const ok = "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01";
  assert.equal(isAllowedUrl(ok, "POST"), true);
  assert.equal(isAllowedUrl("https://management.azure.com/subscriptions/x/providers/Microsoft.Authorization/locks?api-version=2016-09-01", "GET"), true);
  assert.equal(isAllowedUrl("https://management.azure.com/subscriptions/x/providers/Microsoft.Authorization/locks?api-version=2016-09-01", "POST"), false);
  assert.equal(isAllowedUrl("https://management.azure.com/subscriptions/x/resourceGroups/g?api-version=2021-04-01", "DELETE"), false);
  for (const u of ["http://management.azure.com/x?api-version=1", "https://management.azure.com.evil.test/x?api-version=1", "https://management.azure.com@evil.test/x?api-version=1", "https://evil.test/https://management.azure.com/x", "file:///etc/passwd", "management.azure.com/x"])
    assert.equal(isAllowedUrl(u, "GET"), false, u);
});

test("error class from stderr and exit state, never the body", () => {
  assert.deepEqual(classifyAzError("ERROR: Too Many Requests (429)", {}), { class: "throttled", status: 429 });
  assert.deepEqual(classifyAzError("(AuthorizationFailed) The client does not have authorization 403", {}), { class: "no-permission", status: 403 });
  assert.deepEqual(classifyAzError("Please run 'az login' to setup account.", {}), { class: "not-logged-in", status: 401 });
  assert.deepEqual(classifyAzError("Bad Gateway 502", {}), { class: "http", status: 502 });
  assert.deepEqual(classifyAzError("", { timedOut: true }), { class: "timeout", status: null });
  assert.deepEqual(classifyAzError("something /subscriptions/x/resourceGroups/secret-name broke", {}), { class: "error", status: null });
});

test("platform: az path rules inside WSL and on Windows", () => {
  const wsl = { wsl: true, platform: "linux" };
  assert.equal(classifyAzPath("/usr/bin/az", wsl).ok, true);
  for (const p of ["/mnt/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin/az.cmd", "/mnt/c/x/az.exe", "/usr/bin/az.cmd", "/opt/az.EXE"]) assert.equal(classifyAzPath(p, wsl).ok, false, p);
  assert.equal(classifyAzPath("/mnt/c/x/az.cmd", { wsl: false, platform: "linux" }).ok, false, "a .cmd is not a Linux launcher");
  const win = classifyAzPath("C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd", { wsl: false, platform: "win32" });
  assert.equal(win.ok, true);
  assert.equal(win.needsShell, true);
  assert.equal(classifyAzPath("/usr/bin/az", wsl).needsShell, false);
});

test("platform: constant arguments only reach a Windows shell", () => {
  assert.equal(quoteWinArg("account"), "account");
  assert.equal(quoteWinArg("@C:\\Temp\\body.json"), "@C:\\Temp\\body.json");
  for (const bad of ["a&b", "a|b", "a^b", "a%PATH%", 'a"b', "a\nb", "a;b", "a>b", "a<b", "a`b", "a$(b)"]) assert.throws(() => quoteWinArg(bad), /constant/, bad);
});

test("platform: waf-review/ under /mnt or a synced folder needs an acknowledgment", () => {
  assert.match(runBaseProblem("/mnt/c/Users/x/work/waf-review", { platform: "linux" }) ?? "", /mnt/);
  assert.match(runBaseProblem("/home/x/OneDrive/work/waf-review", { platform: "linux" }) ?? "", /OneDrive/);
  assert.match(runBaseProblem("C:\\Users\\x\\OneDrive - Contoso\\work\\waf-review", { platform: "win32" }) ?? "", /OneDrive/);
  assert.equal(runBaseProblem("/home/x/work/waf-review", { platform: "linux" }), null);
  assert.equal(runBaseProblem("C:\\Users\\x\\work\\waf-review", { platform: "win32" }), null);
});

// ---- the production transport against a stub executable (POSIX only: a Windows launcher needs a shell, manual test M-10) ----
const posix = process.platform !== "win32";
function stub(script) {
  const dir = tmp("waf-az-");
  const f = join(dir, "az");
  writeFileSync(f, `#!${process.execPath}\n${script}\n`);
  chmodSync(f, 0o755);
  return { azPath: f, log: join(dir, "log.json"), dir };
}

test("transport: Resource Graph goes through az rest with constant arguments and a body file", { skip: !posix && "a Windows launcher needs a shell (M-10)" }, async () => {
  const dir = tmp("waf-az-");
  const logPath = join(dir, "log.json");
  const s = stub(`const fs=require("fs");const a=process.argv.slice(2);const body=a.find(x=>x.startsWith("@"));
fs.writeFileSync(${JSON.stringify(logPath)},JSON.stringify({a,env:Object.keys(process.env).sort(),body:JSON.parse(fs.readFileSync(body.slice(1),"utf8"))}));
process.stdout.write(JSON.stringify({data:[{id:"x"}],count:1,totalRecords:1,resultTruncated:"false"}));`);
  s.log = logPath;
  const t = createAzTransport({ azPath: s.azPath, parentEnv: { PATH: process.env.PATH, HOME: "/h", ANTHROPIC_API_KEY: "must-not-pass", AZURE_CONFIG_DIR: "/c" }, timeoutSec: 20 });
  const r = await t.resourceGraph({ query: "resources | project id", subscriptions: [GUID], options: { $top: 1000 } }, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.data[0].id, "x");
  const log = JSON.parse(readFileSync(s.log, "utf8"));
  assert.deepEqual(log.a.slice(0, 6), ["rest", "--method", "post", "--url", "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01", "--body"]);
  assert.ok(log.a[6].startsWith("@") && log.a.at(-1) === "--only-show-errors" && log.a.length === 8, log.a.join(" "));
  assert.ok(!log.a.includes("--debug") && !log.a.includes("--verbose"));
  assert.equal(log.body.query, "resources | project id");
  assert.ok(!log.env.includes("ANTHROPIC_API_KEY"));
  assert.ok(log.env.includes("AZURE_CORE_COLLECT_TELEMETRY"));
});

test("transport: a failing az becomes a status and a class, with no output kept", { skip: !posix && "see above" }, async () => {
  const s = stub(`process.stderr.write("ERROR: Too Many Requests (429) for /subscriptions/leak-me");process.exit(1);`);
  const t = createAzTransport({ azPath: s.azPath, parentEnv: { PATH: process.env.PATH }, timeoutSec: 20 });
  const r = await t.resourceGraph({ query: "resources | project id", subscriptions: [GUID], options: {} }, {});
  assert.equal(r.status, 429);
  assert.equal(r.errorClass, "throttled");
  assert.ok(!JSON.stringify(r).includes("leak-me"));
  const bad = await t.azRead(["az", "account", "get-access-token"]).catch((e) => e);
  assert.ok(bad instanceof Error && /closed list/.test(bad.message));
  await assert.rejects(() => t.restGet("https://example.invalid/x?api-version=1", {}), /allowlist|host/i);
});
