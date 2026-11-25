// The YAML corpus of OpenSpec change vendor-stacks-engine-yaml: inputs that the engine's parser must treat the same
// before and after the package was vendored. `run` serializes what a parser returns; golden.json is what it returned.
// Inputs that can exhaust the stack or the heap are `child` cases: they run in a child process (child.mjs).

const bomb = (() => {
  let s = "l0: &l0 [x, x, x, x, x, x, x, x, x]\n";
  for (let i = 1; i <= 5; i++) s += `l${i}: &l${i} [${Array(9).fill(`*l${i - 1}`).join(", ")}]\n`;
  return s;
})();

/** In-process cases: name -> source text. */
export const cases = {
  "alias-bomb": bomb,
  "alias-reuse": "base: &b {a: 1, b: [1, 2]}\nx: *b\ny: *b\n",
  "tag-custom": "a: !custom 1\nb: !!str 2\n",
  "tag-core": "a: !!int '3'\nb: !!float 1\nc: !!null ''\nd: !!bool 'true'\n",
  "merge-key": "x: &m {a: 1}\ny:\n  <<: *m\n  b: 2\n",
  "dup-keys": "a: 1\na: 2\n",
  "multi-doc": "a: 1\n---\nb: 2\n",
  "doc-markers": "---\na: 1\n...\n---\nb: 2\n...\n",
  "doc-directive": "%YAML 1.2\n---\na: 1\n",
  crlf: "a: 1\r\nb:\r\n  - x\r\n  - y\r\nc: |\r\n  one\r\n  two\r\n",
  "lone-cr": "a: 1\rb: 2\r",
  bom: "\uFEFFa: 1\nb: [1, 2]\n",
  tabs: "a:\n\t- b\n",
  "tab-in-flow": "a: [1,\t2]\n",
  "unknown-alias": "a: *z\n",
  "syntax-error": "a: [\n",
  "bad-indent": "a:\n  b: 1\n c: 2\n",
  empty: "",
  comments: "# only a comment\n",
  "scalars-core": "a: yes\nb: 0o10\nc: 0x1F\nd: 1_000\ne: ~\nf: 2001-01-01\ng: .inf\nh: 'x'\ni: \"y\\n\"\n",
  "block-scalars": "a: |\n  x\n  y\nb: >-\n  p\n  q\nc: |+\n  keep\n\n",
  "complex-keys": "? [a, b]\n: 1\n? {c: d}\n: 2\n",
  "unicode": "k\u00e9y: \u00fcber \ud83d\ude00\n\"\\u00e9\": 1\n",
  "manifest-comments": "version: 1\n# the regions\nregions: { brazilsouth: brs }  # short codes\nstacks:\n  # first\n  - { name: network-platform, type: network, owner: platform }  # trailing\n  - { name: app-orders, type: app, owner: orders, dependsOn: [network-platform] }\n",
  "add-stack": { src: "version: 1\n# keep me\nstacks:\n  - { name: network-platform, type: network, owner: platform }  # trailing\n", addStack: { name: "app-orders", type: "app", owner: "orders", dependsOn: ["network-platform"] } },
};

/** Child-process cases: name -> list of sources (parsed one after the other in one process, as `audit` does for many files). */
export const childCases = {
  "flow-5000": () => ["[".repeat(5000) + "]".repeat(5000)],
  "block-3000": () => ["a:\n" + Array.from({ length: 3000 }, (_, i) => " ".repeat(i + 1) + `k${i}:\n`).join("")],
  "scalar-1MiB": () => ["a: " + "x".repeat(1024 * 1024) + "\n"],
  "aliases-many": () => [Array.from({ length: 2000 }, (_, i) => `k${i}: &a${i} v${i}\n`).join("") + "r: *a1999\n"],
};

/** Observed, never asserted as a value: only that the vendored copy and the package end the same way. */
export const parityOnlyChildCases = {
  "flow-1000-then-10000": () => ["[".repeat(1000) + "]".repeat(1000), "[".repeat(10000) + "]".repeat(10000)],
};

const err = (e) => ({ name: e?.name, code: e?.code, message: String(e?.message), linePos: e?.linePos ?? null });
const attempt = (fn) => { try { return { ok: fn() }; } catch (e) { return { error: err(e) }; } };
// JSON cannot hold undefined, NaN, Infinity or Date: tag them so a difference is not lost
const plain = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "number" && !Number.isFinite(x) ? `#${x}` : x instanceof Date ? `#date:${x.toISOString()}` : x === undefined ? "#undefined" : x instanceof Map ? { "#map": [...x] } : x)));

/** What the three entry points the engine uses return for one source. */
export function runOne(Y, spec) {
  const src = typeof spec === "string" ? spec : spec.src;
  const out = {
    parse: attempt(() => plain(Y.parse(src))),
    roundTrip: attempt(() => Y.parseDocument(src).toString()),
    all: attempt(() => Y.parseAllDocuments(src).map((d) => ({ errors: d.errors.map(err), warnings: d.warnings.map(err), js: attempt(() => plain(d.toJS())) }))),
  };
  if (spec.addStack) {
    out.addStack = attempt(() => {
      const doc = Y.parseDocument(src);
      const stacks = doc.get("stacks");
      const node = doc.createNode(spec.addStack);
      node.flow = true;
      stacks.items.push(node);
      return doc.toString();
    });
  }
  return out;
}

/** Runs every in-process case; warnings (process.emitWarning of the parser) are collected per case. */
export async function runAll(Y) {
  const result = {};
  for (const [name, spec] of Object.entries(cases)) {
    const warnings = [];
    const on = (w) => warnings.push({ name: w.name, code: w.code });
    process.on("warning", on);
    result[name] = runOne(Y, spec);
    await new Promise((r) => setImmediate(r));
    process.off("warning", on);
    result[name].processWarnings = warnings;
  }
  return result;
}
