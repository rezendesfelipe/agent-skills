// Runs one absence search in a worker thread, so the caller can stop it by time. Receives the files and the
// pattern, answers on a message port, then wakes the blocked caller. No file or network access of its own.
import { workerData } from "node:worker_threads";

const { port, flag, pattern, flags, docs, maxLineChars, maxShown } = workerData;
const re = new RegExp(pattern, flags);
const matches = [];
let total = 0;
for (const doc of docs) {
  const lines = doc.lines;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i].slice(0, maxLineChars))) {
      total++;
      if (matches.length < maxShown) matches.push({ path: doc.path, line: i + 1, text: lines[i] });
    }
  }
}
port.postMessage({ total, matches });
Atomics.store(flag, 0, 1);
Atomics.notify(flag, 0);
