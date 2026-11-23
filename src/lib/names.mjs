// Rules for the names of skills and agents. An agent name becomes a file name in a tool's
// agents folder on every OS, so it is checked again at install time, not only in validation.

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_NAME_LENGTH = 64;
// Windows device names: a file called aux.md or con.toml cannot be created there.
export const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** @returns {string|null} why the name cannot be used as an agent name, or null when it can */
export function agentNameProblem(name) {
  if (typeof name !== "string" || !name) return "the name is empty";
  if (name.length > MAX_NAME_LENGTH) return `name is longer than ${MAX_NAME_LENGTH} characters`;
  if (!NAME_RE.test(name)) return `name "${name}" must be kebab-case (lowercase letters, digits and single hyphens)`;
  if (WINDOWS_RESERVED_RE.test(name)) return `name "${name}" is a Windows reserved device name`;
  return null;
}
