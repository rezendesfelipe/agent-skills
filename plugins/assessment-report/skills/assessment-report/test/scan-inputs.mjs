// Shared by the scanner tests: pathological inputs, a timer, and the initial bounds (all initial values to calibrate).
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
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

let workersStarted = 0;
/** How many Workers `measure()` has started in this process (the property test sizes its total ceiling with it). */
export const workersStartedCount = () => workersStarted;

/**
 * Ceiling of the whole property test: relative to the runner (workers x the smallest Worker round trip), never below
 * DEADLINE_MS. With no usable reference (0 measurements leaves Infinity, or NaN) it falls back to DEADLINE_MS, so the
 * total-time assertion still has a finite limit instead of passing against Infinity or NaN.
 */
export function totalCeiling(workers, reference, factor) {
  return Number.isFinite(reference) ? Math.max(DEADLINE_MS, factor * workers * reference) : DEADLINE_MS;
}

export const DEADLINE_MS = 10000; // initial value: a measurement that takes longer is a hang, and fails the test

/**
 * Times the scanner in a worker thread: the whole scan and every pattern alone, best of `runs`. The worker is
 * terminated at the deadline, so a super-linear pattern fails the test within DEADLINE_MS instead of hanging it.
 * `spec` is {text} or {shape, length}. @returns {Promise<{scan: number, patterns: Record<string, number>}>}
 */
export function measure(spec, { runs = 2, deadlineMs = DEADLINE_MS } = {}) {
  return new Promise((resolve, reject) => {
    workersStarted++;
    const worker = new Worker(new URL("./scan-worker.mjs", import.meta.url));
    const timer = setTimeout(() => { worker.terminate(); reject(new Error(`the scan did not finish within ${deadlineMs} ms (a pattern is no longer linear?)`)); }, deadlineMs);
    worker.once("message", (m) => { clearTimeout(timer); worker.terminate(); resolve(m); });
    worker.once("error", (e) => { clearTimeout(timer); reject(e); });
    worker.postMessage({ ...spec, runs });
  });
}

/**
 * Does doubling the input multiply the time by less than SCALE_RATIO_BOUND, for the whole scan and for each pattern?
 * Timing is noisy when test files run in parallel, so a failed attempt is repeated up to 3 times: a quadratic pattern
 * fails every attempt (ratio near 4). Below `floorMs` for the small input the ratio means nothing.
 * @returns {Promise<{ok: boolean, detail: string, bigScanMs: number, bigPatterns: Record<string, number>}>}
 */
export async function scalesFor(small, big, floorMs = 8) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = await measure({ text: small }, { runs: 3 });
    const b = await measure({ text: big }, { runs: 3 });
    const bad = [["scan", a.scan, b.scan], ...Object.keys(a.patterns).map((k) => [k, a.patterns[k], b.patterns[k]])].filter(([, x, y]) => x > floorMs && y / x >= SCALE_RATIO_BOUND);
    last = { ok: bad.length === 0, detail: bad.map(([k, x, y]) => `${k}: ${x.toFixed(1)} ms -> ${y.toFixed(1)} ms`).join("; "), bigScanMs: b.scan, bigPatterns: b.patterns };
    if (last.ok) return last;
  }
  return last;
}
