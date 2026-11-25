// The templates directory must be a real filesystem path on every OS (it was `new URL(...).pathname`, `/D:/a/...` on Windows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { templatesDir } from "../scripts/lib/gen-terraform.mjs";

// fileURLToPath(url, { windows }) exists from Node 20.13 / 22.1; the repo CI runs the latest 20.x.
const hasWindowsOption = (() => { try { return fileURLToPath("file:///D:/a/x", { windows: true }) === "D:\\a\\x"; } catch { return false; } })();

test("templatesDir resolves a Windows file URL to a drive path without the leading slash or a doubled drive", { skip: !hasWindowsOption && "fileURLToPath(url, { windows }) needs Node >= 20.13" }, () => {
  const base = "file:///D:/a/agent-skills/agent-skills/plugins/azure-terraform-stacks/skills/azure-terraform-stacks/scripts/lib/gen-terraform.mjs";
  const dir = templatesDir(base, { windows: true });
  assert.ok(!dir.startsWith("/"), dir);
  assert.ok(!dir.startsWith("\\"), dir);
  assert.ok(!/^[A-Za-z]:[\\/]+[A-Za-z]:/.test(win32.join(dir, "terraform/modules")), "the drive must not be doubled");
  assert.equal(win32.join(dir, "terraform", "modules"),
    "D:\\a\\agent-skills\\agent-skills\\plugins\\azure-terraform-stacks\\skills\\azure-terraform-stacks\\templates\\terraform\\modules");
});

test("templatesDir keeps percent-encoded characters of a Windows path decoded", { skip: !hasWindowsOption && "needs Node >= 20.13" }, () => {
  const dir = templatesDir("file:///C:/Users/Ana%20Silva/repo/scripts/lib/gen-terraform.mjs", { windows: true });
  assert.equal(dir, "C:\\Users\\Ana Silva\\repo\\templates\\");
});

test("templatesDir decodes a POSIX path with a space (%20) on every platform", () => {
  const dir = templatesDir("file:///tmp/a%20b/c/scripts/lib/x.mjs"); // no option: the platform decides (on Windows it is a drive-less path)
  assert.ok(dir.includes("a b"), dir);
  assert.ok(!dir.includes("%20"), dir);
  assert.ok(/templates[\\/]$/.test(dir), dir);
});

test("templatesDir points at the real templates on this platform", () => {
  assert.ok(existsSync(templatesDir()));
});
