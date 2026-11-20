import assert from "node:assert/strict";
import { test } from "node:test";
import { checkbox, confirm, select } from "../src/cli/prompt.mjs";
import { KEY, collector, fakeTTY, type } from "./helpers.mjs";

const choices = ["one", "two", "three"].map((v) => ({ value: v, label: v }));

async function drive(prompt, opts, keys) {
  const input = fakeTTY();
  const out = collector();
  const result = prompt({ ...opts, input, output: out.stream });
  await type(input, keys);
  return { value: await result, output: out.text(), input };
}

test("checkbox: move and toggle", async () => {
  const r = await drive(checkbox, { message: "Pick", choices }, [KEY.down, KEY.space, KEY.down, KEY.space, KEY.enter]);
  assert.deepEqual(r.value, ["two", "three"]);
  assert.equal(r.input.isRaw, false, "raw mode restored");
});

test("checkbox: up wraps to the last item", async () => {
  const r = await drive(checkbox, { message: "Pick", choices }, [KEY.up, KEY.space, KEY.enter]);
  assert.deepEqual(r.value, ["three"]);
});

test("checkbox: a toggles all, twice clears", async () => {
  assert.deepEqual((await drive(checkbox, { message: "Pick", choices }, ["a", KEY.enter])).value, ["one", "two", "three"]);
  assert.deepEqual((await drive(checkbox, { message: "Pick", choices }, ["a", "a", KEY.enter])).value, []);
});

test("checkbox: preselected values and empty confirm", async () => {
  const pre = choices.map((c) => ({ ...c, checked: c.value === "two" }));
  assert.deepEqual((await drive(checkbox, { message: "Pick", choices: pre }, [KEY.enter])).value, ["two"]);
  assert.deepEqual((await drive(checkbox, { message: "Pick", choices }, [KEY.enter])).value, []);
});

test("checkbox: Ctrl+C resolves to null", async () => {
  const r = await drive(checkbox, { message: "Pick", choices }, [KEY.space, KEY.ctrlC]);
  assert.equal(r.value, null);
  assert.match(r.output, /cancelled/);
});

test("checkbox: long lists scroll within the terminal height", async () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ value: `s${i}`, label: `skill-${i}` }));
  const r = await drive(checkbox, { message: "Pick", choices: many }, [KEY.enter]);
  const firstFrame = r.output.split("\x1b[0J")[0];
  assert.match(firstFrame, /↓ more/);
  assert.ok(!firstFrame.includes("skill-49"));
});

test("select: initial value and moving", async () => {
  const opts = { message: "Scope?", choices, initial: "two" };
  assert.equal((await drive(select, opts, [KEY.enter])).value, "two");
  assert.equal((await drive(select, opts, [KEY.down, KEY.enter])).value, "three");
});

test("confirm: y, n, enter default", async () => {
  assert.equal((await drive(confirm, { message: "Go?" }, ["y"])).value, true);
  assert.equal((await drive(confirm, { message: "Go?" }, ["n"])).value, false);
  assert.equal((await drive(confirm, { message: "Go?" }, [KEY.enter])).value, true);
  assert.equal((await drive(confirm, { message: "Go?" }, [KEY.ctrlC])).value, null);
});
