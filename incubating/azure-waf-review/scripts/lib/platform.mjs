// Platform rules: the `az` launcher inside WSL and on Windows, constant arguments for a Windows shell, the run folder base.
import { release } from "node:os";
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
