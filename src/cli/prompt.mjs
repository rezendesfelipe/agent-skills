// Small terminal prompts with no dependencies: checkbox list, single select, confirm.
// Keys: up/down (or k/j) move, space toggles, "a" toggles all, enter confirms,
// Ctrl+C or Esc cancels (resolves to null). Prompts draw on `output` (stderr by default)
// so stdout stays clean for --json.
import { emitKeypressEvents } from "node:readline";

const CSI = "\x1b[";

function run({ input, output, render, onKey }) {
  return new Promise((resolve) => {
    emitKeypressEvents(input);
    const wasRaw = input.isRaw;
    input.setRawMode?.(true);
    input.resume();
    output.write(`${CSI}?25l`);
    let drawn = 0;

    const draw = (text) => {
      const cols = Math.max(20, (output.columns || 80) - 1);
      const lines = text.split("\n").map((l) => (visibleLength(l) > cols ? truncate(l, cols) : l));
      if (drawn) output.write(`\r${CSI}${drawn}A${CSI}0J`);
      output.write(lines.join("\n") + "\n");
      drawn = lines.length;
    };

    const finish = (value, summary) => {
      input.off("keypress", handler);
      input.setRawMode?.(wasRaw ?? false);
      input.pause();
      draw(summary);
      output.write(`${CSI}?25h`);
      resolve(value);
    };

    const handler = (str, key = {}) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape") return finish(null, render({ cancelled: true }));
      const result = onKey(str, key);
      if (result && "done" in result) return finish(result.value, render({ done: true }));
      draw(render({}));
    };

    input.on("keypress", handler);
    draw(render({}));
  });
}

const visibleLength = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
const truncate = (s, n) => s.replace(/\x1b\[[0-9;]*m/g, "").slice(0, n - 1) + "…";
const dim = (s) => `${CSI}2m${s}${CSI}22m`;
const bold = (s) => `${CSI}1m${s}${CSI}22m`;

function windowed(choices, cursor, rows) {
  const size = Math.min(choices.length, Math.max(3, (rows || 24) - 4));
  const start = Math.min(Math.max(0, cursor - Math.floor(size / 2)), Math.max(0, choices.length - size));
  return { start, end: start + size };
}

function move(cursor, key, length) {
  if (key.name === "up" || key.name === "k") return (cursor - 1 + length) % length;
  if (key.name === "down" || key.name === "j") return (cursor + 1) % length;
  return cursor;
}

/**
 * @param {{message: string, choices: {value: string, label: string, hint?: string, checked?: boolean}[], input, output}} o
 * @returns {Promise<string[]|null>} selected values, [] when confirmed empty, null when cancelled
 */
export function checkbox({ message, choices, input = process.stdin, output = process.stderr }) {
  let cursor = 0;
  const checked = new Set(choices.filter((c) => c.checked).map((c) => c.value));
  const selected = () => choices.filter((c) => checked.has(c.value)).map((c) => c.value);
  return run({
    input,
    output,
    render: ({ done, cancelled }) => {
      if (cancelled) return `${bold("?")} ${message} ${dim("cancelled")}`;
      if (done) return `${bold("✔")} ${message} ${selected().join(", ") || dim("none")}`;
      const { start, end } = windowed(choices, cursor, output.rows);
      const lines = [`${bold("?")} ${message} ${dim("(↑/↓ move, space select, a all, enter confirm)")}`];
      if (start > 0) lines.push(dim("  ↑ more"));
      for (let i = start; i < end; i++) {
        const c = choices[i];
        const pointer = i === cursor ? "❯" : " ";
        const box = checked.has(c.value) ? "◉" : "◯";
        lines.push(`${pointer} ${box} ${c.label}${c.hint ? dim(` — ${c.hint}`) : ""}`);
      }
      if (end < choices.length) lines.push(dim("  ↓ more"));
      return lines.join("\n");
    },
    onKey: (str, key) => {
      if (key.name === "return" || key.name === "enter") return { done: true, value: selected() };
      if (key.name === "space") {
        const v = choices[cursor].value;
        checked.has(v) ? checked.delete(v) : checked.add(v);
      } else if (str === "a") {
        if (checked.size === choices.length) checked.clear();
        else choices.forEach((c) => checked.add(c.value));
      } else cursor = move(cursor, key, choices.length);
    },
  });
}

/** @returns {Promise<string|null>} */
export function select({ message, choices, initial, input = process.stdin, output = process.stderr }) {
  let cursor = Math.max(0, choices.findIndex((c) => c.value === initial));
  return run({
    input,
    output,
    render: ({ done, cancelled }) => {
      if (cancelled) return `${bold("?")} ${message} ${dim("cancelled")}`;
      if (done) return `${bold("✔")} ${message} ${choices[cursor].value}`;
      const lines = [`${bold("?")} ${message} ${dim("(↑/↓ move, enter confirm)")}`];
      choices.forEach((c, i) => {
        lines.push(`${i === cursor ? "❯" : " "} ${c.label}${c.hint ? dim(` — ${c.hint}`) : ""}`);
      });
      return lines.join("\n");
    },
    onKey: (_str, key) => {
      if (key.name === "return" || key.name === "enter") return { done: true, value: choices[cursor].value };
      cursor = move(cursor, key, choices.length);
    },
  });
}

/** @returns {Promise<boolean|null>} */
export function confirm({ message, initial = true, input = process.stdin, output = process.stderr }) {
  let answer = initial;
  return run({
    input,
    output,
    render: ({ done, cancelled }) => {
      if (cancelled) return `${bold("?")} ${message} ${dim("cancelled")}`;
      if (done) return `${bold("✔")} ${message} ${answer ? "yes" : "no"}`;
      return `${bold("?")} ${message} ${dim(initial ? "(Y/n)" : "(y/N)")}`;
    },
    onKey: (str, key) => {
      if (key.name === "return" || key.name === "enter") return { done: true, value: answer };
      if (str === "y" || str === "Y") return { done: true, value: (answer = true) };
      if (str === "n" || str === "N") return { done: true, value: (answer = false) };
    },
  });
}
