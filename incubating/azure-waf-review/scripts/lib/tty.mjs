// The terminal of the user. The commands that carry the user's decision (consent, reverify, purge) run only with a real terminal on
// stdin and stdout: piped answers (`echo yes | waf.mjs consent`) are exactly what an agent could do, so they are refused. Tests drive the
// library with an injected `io` instead. A terminal is a control against accidents and against a model that runs a command; it is not
// proof of a human (a pseudo-terminal can be made), which is why the guard of PR 4 also denies these commands.
import { createInterface } from "node:readline";

export const hasTerminal = ({ stdin = process.stdin, stdout = process.stdout } = {}) => Boolean(stdin.isTTY && stdout.isTTY);

/** @returns {{ask: (q: string) => Promise<string>, print: (s?: string) => void, close: () => void}} */
export function terminalIo({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  return {
    ask: (q) => new Promise((resolve) => rl.question(q, (a) => resolve(a))),
    print: (s = "") => stdout.write(`${s}\n`),
    close: () => rl.close(),
  };
}
