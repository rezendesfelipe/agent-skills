// Worker for the timing tests: measures the scanner off the main thread, so a pattern that regresses to super-linear
// time can be cut off by a deadline (terminate) and the test FAILS fast instead of hanging. Not a test file.
import { parentPort } from "node:worker_threads";
import { SECRET_PATTERNS, scanString } from "../scripts/lib/secrets.mjs";
import { SHAPES, bestTime } from "./scan-inputs.mjs";

parentPort.on("message", ({ text, shape, length, runs = 2, scanOnly = false }) => {
  const input = text ?? SHAPES[shape](length);
  const patterns = scanOnly ? {} : Object.fromEntries(SECRET_PATTERNS.map(({ kind, re }) => [kind, bestTime(() => re.test(input), runs)]));
  const scan = bestTime(() => scanString(input), runs);
  parentPort.postMessage({ scan, patterns });
});
