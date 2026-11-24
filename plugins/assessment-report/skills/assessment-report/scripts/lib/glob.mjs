// A small glob matcher: `*` (no slash), `**` (any depth) and `?`. Nothing else is special.
// Patterns and paths use "/" separators. A pattern without a slash matches at any depth (like .gitignore).

export function globToRegExp(pattern) {
  let p = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const anyDepth = !p.includes("/");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        // `**/` matches zero or more directories; a trailing `**` matches everything below
        if (p[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${anyDepth ? "(?:.*/)?" : ""}${re}$`);
}

export function matchGlob(pattern, path) {
  return globToRegExp(pattern).test(path);
}

export function matchAny(patterns, path) {
  return patterns.some((p) => matchGlob(p, path));
}
