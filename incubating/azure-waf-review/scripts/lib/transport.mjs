// The transport: the one place that reaches Azure. Production starts `az` (execFile, constant arguments, environment
// allowlist); tests and documentation use the fixture transport. Both answer with { status, body?, errorClass? } and never
// keep an error body (only a class and a status).
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARG_PATH, MGMT_HOST, azArgs, childEnv, isAllowedAzVector, isAllowedUrl } from "./azread.mjs";
import { kqlProblems } from "./kql.mjs";
import { classifyAzPath, quoteWinArg } from "./platform.mjs";

const ARG_URL = `https://${MGMT_HOST}${ARG_PATH}?api-version=2022-10-01`;

/** Error class and status from what `az` printed. The text itself is never stored. */
export function classifyAzError(stderr, { timedOut = false } = {}) {
  if (timedOut) return { class: "timeout", status: null };
  const t = String(stderr);
  if (/\b429\b|too many requests|TooManyRequests/i.test(t)) return { class: "throttled", status: 429 };
  if (/\b403\b|AuthorizationFailed|Forbidden|does not have authorization/i.test(t)) return { class: "no-permission", status: 403 };
  if (/az login|AADSTS|not logged in|\b401\b|Unauthorized/i.test(t)) return { class: "not-logged-in", status: 401 };
  const m = t.match(/\b(408|50[0-4])\b/);
  if (m) return { class: m[1] === "408" ? "timeout" : "http", status: Number(m[1]) };
  return { class: "error", status: null };
}

/** Production transport. `spawnFile` is injectable for tests. */
export function createAzTransport({ azPath = "az", parentEnv = process.env, timeoutSec = 30, workDir = null, platform = process.platform, wsl = false, spawnFile = execFile } = {}) {
  const path = classifyAzPath(azPath, { wsl, platform });
  if (!path.ok) throw new Error(`az launcher refused: ${path.reason}`);
  const env = childEnv(parentEnv, { platform });

  const start = (args, { timeoutMs }) =>
    new Promise((resolve) => {
      const done = (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), timedOut: Boolean(err && err.killed && err.signal) });
      const opts = { env, timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024, windowsHide: true };
      if (path.needsShell) spawnFile([quoteWinArg(azPath), ...args.map(quoteWinArg)].join(" "), [], { ...opts, shell: true }, done);
      else spawnFile(azPath, args, opts, done);
    });

  async function call(args, ctx, timeoutMs = timeoutSec * 1000 + 15_000) {
    const r = await start(args, { timeoutMs });
    if (r.code === 0 && !r.timedOut) {
      try {
        return { status: 200, body: r.stdout.trim() ? JSON.parse(r.stdout) : null };
      } catch {
        return { status: 200, text: r.stdout };
      }
    }
    const c = classifyAzError(r.stderr, { timedOut: r.timedOut });
    return { status: c.status, errorClass: c.class };
  }

  return {
    kind: "az",
    async resourceGraph(req, ctx = {}) {
      const problems = kqlProblems(req.query);
      if (problems.length) throw new Error(`query refused by the allowlist: ${problems[0]}`);
      const dir = workDir ?? tmpdir();
      mkdirSync(dir, { recursive: true });
      const tmp = mkdtempSync(join(dir, "waf-body-"));
      const file = join(tmp, "body.json");
      try {
        writeFileSync(file, JSON.stringify({ query: req.query, ...(req.subscriptions ? { subscriptions: req.subscriptions } : {}), ...(req.managementGroups ? { managementGroups: req.managementGroups } : {}), options: req.options ?? {} }), { mode: 0o600 });
        return await call(["rest", "--method", "post", "--url", ARG_URL, "--body", `@${file}`, "--only-show-errors"], ctx);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    async restGet(url, ctx = {}) {
      if (!isAllowedUrl(url, "GET")) throw new Error("URL is not on the allowlist (host, https and api-version)");
      return call(["rest", "--method", "get", "--url", url, "--only-show-errors"], ctx);
    },
    async azRead(vector) {
      const args = azArgs(vector); // throws when the vector is not on the closed list
      return call(args, {});
    },
  };
}

/** Fixture transport: answers from files of the synthetic tenant. Used by tests and by `--fixtures` only. */
export function createFixtureTransport(dir) {
  const readJson = (rel) => { const f = join(dir, rel); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, "")) : null; };
  return {
    kind: "fixtures",
    async resourceGraph(req, ctx = {}) {
      const data = readJson(`arg/${ctx.checkId}.json`);
      const pages = data?.[ctx.role]?.pages;
      if (!pages) return { status: 404, errorClass: "http" };
      const tok = req.options?.$skipToken;
      const i = tok ? Number(String(tok).match(/(\d+)$/)?.[1]) - 1 : 0;
      const page = pages[i];
      if (!page) return { status: 400, errorClass: "http" };
      const subs = req.subscriptions;
      const rows = page.rows.filter((r) => !subs || !r.subscriptionId || subs.includes(r.subscriptionId));
      return { status: 200, body: { data: rows, count: rows.length, totalRecords: rows.length, resultTruncated: page.resultTruncated ?? "false", ...(page.$skipToken ? { $skipToken: page.$skipToken } : {}) } };
    },
    async restGet(url, ctx = {}) {
      const data = readJson(`rest/${ctx.checkId}.json`);
      const sub = url.match(/\/subscriptions\/([^/]+)\//)?.[1];
      const body = data?.bySubscription?.[sub];
      return body ? { status: 200, body } : { status: 404, errorClass: "http" };
    },
    async azRead(vector) {
      if (!isAllowedAzVector(vector)) throw new Error(`az vector is not on the closed list: ${JSON.stringify(vector)}`);
      if (vector[1] === "--version") return { status: 200, body: { "azure-cli": "fixture" } };
      if (vector[1] === "account" && vector[2] === "list") return { status: 200, body: readJson("az/account-list.json") ?? [] };
      return { status: 404, errorClass: "http" };
    },
    /** Only the fixture knows the subscriptions under the management group and the typed count (consent supplies them in PR 1b). */
    fixtureScope() {
      return readJson("scope.json");
    },
  };
}
