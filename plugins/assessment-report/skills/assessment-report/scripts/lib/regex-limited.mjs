// Runs a search regular expression with a real time limit, synchronously, without a dependency: the search runs
// in a worker thread while the caller waits on a shared flag, and the worker is terminated at the deadline.
// A regular expression can backtrack for minutes, and no static check catches every such pattern, so the
// time limit is the guarantee; the syntax checks in patternProblem are an early, cheap refusal.
import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";

export const REGEX_TIMEOUT_MS = 3000;
const WORKER = new URL("./regex-worker.mjs", import.meta.url);

/**
 * @param {{pattern: string, flags?: string, docs: {path: string, lines: string[]}[], maxLineChars: number, maxShown: number, timeoutMs?: number}} o
 * @returns {{timedOut: boolean, total?: number, matches?: {path: string, line: number, text: string}[]}}
 */
export function searchWithLimit({ pattern, flags = "", docs, maxLineChars, maxShown, timeoutMs = REGEX_TIMEOUT_MS }) {
  const flag = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(WORKER, { workerData: { port: port2, flag, pattern, flags, docs, maxLineChars, maxShown }, transferList: [port2] });
  worker.unref();
  worker.on("error", () => {});
  Atomics.wait(flag, 0, 0, timeoutMs);
  const done = Atomics.load(flag, 0) === 1;
  const msg = done ? receiveMessageOnPort(port1)?.message : undefined;
  worker.terminate();
  port1.close();
  return done && msg ? { timedOut: false, ...msg } : { timedOut: true };
}
