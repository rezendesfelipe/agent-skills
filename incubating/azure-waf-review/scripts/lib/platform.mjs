// Platform rules: the `az` launcher inside WSL and on Windows, constant arguments for a Windows shell, the run folder base.
import { accessSync, constants as fsConstants, realpathSync, statSync } from "node:fs";
import { homedir, release } from "node:os";
import path from "node:path";

export const isWsl = ({ env = process.env, rel = release() } = {}) => Boolean(env.WSL_DISTRO_NAME) || /microsoft/i.test(rel);

/** Which `az` may be started. Inside WSL a Windows launcher (/mnt/..., .exe, .cmd) is refused unless the user types an acknowledgment. */
export function classifyAzPath(p, { wsl = false, platform = process.platform } = {}) {
  const lower = String(p).toLowerCase();
  const windowsLauncher = /\.(exe|cmd|bat)$/.test(lower);
  if (platform === "win32") return { ok: true, needsShell: /\.(cmd|bat)$/.test(lower), reason: null };
  if (wsl && (lower.startsWith("/mnt/") || windowsLauncher))
    return { ok: false, needsShell: false, reason: `a Windows executable inside WSL (${p}); install the Azure CLI inside the Linux distro` };
  if (windowsLauncher) return { ok: false, needsShell: false, reason: `${p} is not a launcher on this platform` };
  return { ok: true, needsShell: false, reason: null };
}

/** The Windows launcher is started through a shell, so only constant, plain arguments may reach it. */
export function quoteWinArg(a) {
  if (typeof a !== "string" || !/^[A-Za-z0-9_@:.\\/=,+~ -]*$/.test(a)) throw new Error(`argument ${JSON.stringify(a)} is not constant and plain; refused before it reaches a shell`);
  return /\s/.test(a) ? `"${a}"` : a;
}

const SYNCED = [/^onedrive(\b|\s-)/i, /^dropbox\b/i, /^google drive\b/i, /^icloud ?drive\b/i, /^sharepoint\b/i];
/** A problem when `waf-review/` would sit on a Windows drive seen from WSL or in a synced folder; null otherwise. */
export function runBaseProblem(p, { platform = process.platform } = {}) {
  const lib = platform === "win32" ? path.win32 : path.posix;
  const norm = lib.normalize(String(p));
  if (platform !== "win32" && /^\/mnt\//.test(norm)) return "the folder is under /mnt/ (a Windows drive mounted in WSL: slow, and visible to Windows tools and sync clients); use the Linux filesystem";
  const segs = norm.split(/[\\/]/);
  for (const s of segs) for (const re of SYNCED) if (re.test(s)) return `the folder is inside a synced folder (${s}); collected tenant data would be uploaded by the sync client`;
  return null;
}

/** Finds `az` on a PATH value without a shell. Only absolute directories count (a relative entry such as "." would run a file of the working folder). */
/** The path syntax of the machine the code runs on: a test that simulates Linux on a Windows runner still holds Windows paths. */
const libOf = (platform) => (platform === "win32" || process.platform === "win32" ? path.win32 : path.posix);

export function resolveAz({ pathEnv = process.env.PATH ?? "", platform = process.platform, isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } }, isExec = (p) => { try { accessSync(p, fsConstants.X_OK); return true; } catch { return false; } } } = {}) {
  const lib = libOf(platform);
  const names = platform === "win32" ? ["az.cmd", "az.exe", "az.bat"] : ["az"];
  for (const dir of String(pathEnv).split(platform === "win32" ? ";" : ":")) {
    if (!dir || !lib.isAbsolute(dir)) continue;
    for (const n of names) {
      const f = lib.join(dir, n);
      if (isFile(f) && (platform === "win32" || isExec(f))) return f;
    }
  }
  return null;
}

/** Why the Azure CLI profile is not isolated, or null. An isolated profile is an existing folder named by AZURE_CONFIG_DIR that is neither the default ~/.azure nor the home folder (or a parent of it). */
export function isolatedProfileProblem({ env = process.env, home = env.HOME ?? "", platform = process.platform } = {}) {
  const lib = libOf(platform);
  home = home || homedir();
  const dir = env.AZURE_CONFIG_DIR;
  if (!dir) return "AZURE_CONFIG_DIR is not set, so az would use the default profile (~/.azure) of your daily account";
  if (!lib.isAbsolute(dir)) return "AZURE_CONFIG_DIR must be an absolute path";
  const norm = lib.resolve(dir);
  const h = home ? lib.resolve(home) : "";
  if (h && norm === lib.resolve(h, ".azure")) return "AZURE_CONFIG_DIR is the default profile (~/.azure)";
  if (norm === lib.parse(norm).root || (h && (norm === h || h.startsWith(norm + lib.sep)))) return "AZURE_CONFIG_DIR is the home folder or a parent of it, not an audit-only folder";
  let real;
  try { if (!statSync(norm).isDirectory()) return "AZURE_CONFIG_DIR is not a folder"; real = realpathSync(norm); } catch { return "AZURE_CONFIG_DIR does not exist (create an audit-only folder and sign in to it yourself)"; }
  if (platform !== "win32" && /^\/mnt\//.test(real)) return "AZURE_CONFIG_DIR is on a Windows drive (/mnt/...): it would be visible to Windows tools and sync clients";
  if (h) { try { if (real === realpathSync(lib.resolve(h, ".azure"))) return "AZURE_CONFIG_DIR resolves to the default profile (~/.azure)"; } catch { /* no default profile */ } }
  return null;
}
