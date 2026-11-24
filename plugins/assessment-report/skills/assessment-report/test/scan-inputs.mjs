// Shared by the scanner tests: pathological inputs, a timer, and the initial bounds (all initial values to calibrate).
import { performance } from "node:perf_hooks";
import { SECRET_PATTERNS, scanString } from "../scripts/lib/secrets.mjs";

// Initial value, to calibrate against the first CI runs: a line of 1 MiB (the file size cap) scans within this time.
export const SCAN_TIME_BOUND_MS = 500;
// Initial value, to calibrate: doubling the length of a pathological line multiplies the time by less than this.
export const SCALE_RATIO_BOUND = 3;
export const MIB = 1024 * 1024;

const c = (...p) => p.join("");
export const repeatTo = (unit, length) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

/** Single-line pathological shapes. Each takes a length in characters. Names are parts, never credential literals. */
export const SHAPES = {
  "short token and separator": (n) => repeatTo("ab12.", n),
  "letter and dot": (n) => repeatTo("a.", n),
  "letter and dash": (n) => repeatTo("a-", n),
  "repeated name prefix": (n) => repeatTo("db_", n),
  "prefix then name": (n) => repeatTo("db_", n - 9) + c("pass", "word") + "=",
  "name and operator repeated": (n) => repeatTo(c("pass", "word", "="), n - 1) + "(",
  "name, tag and operand repeated": (n) => repeatTo(c("pass", "word", ": !Sub x "), n),
  "name and anchor repeated": (n) => repeatTo(c("pass", "word", ": &a #"), n),
  "scheme-like prefix repeated": (n) => repeatTo("a://u:", n),
  "long scheme": (n) => repeatTo("a", n - 3) + "://",
  "scheme with letters and dots": (n) => repeatTo("a.", n - 4) + "b://",
  "run of one character": (n) => "x".repeat(n),
  "spaces before a name": (n) => " ".repeat(n - 10) + c("pass", "word", "=", "x"),
  "separator runs": (n) => repeatTo(c("pass", "word", ":\t"), n),
  "auth scheme repeated": (n) => repeatTo(c("Bear", "er "), n),
  "signature repeated": (n) => repeatTo(c("?si", "g="), n),
  "colon pairs": (n) => repeatTo("x:", n),
  "user and at": (n) => repeatTo("a://b:cde", n),
};

/** Best of a few runs, in milliseconds. */
export function bestTime(fn, runs = 3) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

/** Time of every pattern alone, on a string of the given length (no window), and of scanString. */
export const timePatterns = (text) => SECRET_PATTERNS.map(({ kind, re }) => ({ kind, ms: bestTime(() => re.test(text), 2) }));
export const timeScan = (text) => bestTime(() => scanString(text), 2);
