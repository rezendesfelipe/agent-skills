import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { agentFromText, loadAgent } from "../src/lib/agents/model.mjs";
import { convertAgent, READ_ONLY_NOTE } from "../src/lib/agents/convert.mjs";
import { inspect, markerLine, sha256, stamp } from "../src/lib/agents/marker.mjs";
import { tomlMultiline, tomlString, yamlString } from "../src/lib/agents/serialize.mjs";
import { effectiveTools, restrictionFor } from "../src/lib/agents/permissions.mjs";
import { TOOLS, TOOL_IDS, agentOverlaps, agentsDir } from "../src/lib/tools.mjs";
import { decodeMarkdown, decodeToml } from "./decoders.mjs";
import { FIXTURE_ROOT } from "./helpers.mjs";

const VERSION = "1.2.3";
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "golden", "agents");
const AGENTS = join(FIXTURE_ROOT, "plugins/demo/agents");
const fixture = (name) => loadAgent(join(AGENTS, `${name}.md`));
const convert = (agent, tool, opts = {}) => convertAgent(agent, tool, { version: VERSION, ...opts });
const agentOf = (fm, body = "Prompt.\n") => agentFromText(`---\n${fm}\n---\n${body}`);
const base = "name: x-agent\ndescription: Does a thing.";

function checkGolden(relative, actual) {
  const file = join(GOLDEN, relative);
  if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual);
  }
  assert.ok(existsSync(file), `missing golden file ${relative} (run with UPDATE_GOLDEN=1 and review it)`);
  assert.equal(actual, readFileSync(file, "utf8"), relative);
}

describe("golden files per tool", () => {
  for (const name of readdirSync(AGENTS).map((f) => f.replace(/\.md$/, ""))) {
    for (const tool of TOOL_IDS) {
      test(`${name} for ${tool}`, () => {
        const r = convert(fixture(name), tool);
        if (!r.ok) return assert.match(r.message, /refused for/); // refusals have no file
        checkGolden(`${tool}/${name}${TOOLS[tool].agents.ext}`, r.content);
      });
    }
  }
  test("the Codex file of a restricted agent installed with --allow-broader-access", () => {
    const r = convert(fixture("readonly-reviewer"), "codex", { allowBroader: true });
    assert.ok(r.ok);
    checkGolden("codex/readonly-reviewer.broadened.toml", r.content);
  });
  test("a CRLF source gives the same files as the LF source", () => {
    for (const name of ["quick-scout", "full-access"]) {
      const lf = readFileSync(join(AGENTS, `${name}.md`), "utf8");
      const crlf = "\uFEFF" + lf.replace(/\n/g, "\r\n");
      for (const tool of TOOL_IDS) {
        const a = convert(agentFromText(lf), tool, { allowBroader: true });
        const b = convert(agentFromText(crlf), tool, { allowBroader: true });
        assert.equal(b.content, a.content, `${name} ${tool}`);
      }
    }
  });
});

describe("Converted files", () => {
  const writer = agentOf(`${base}\ntools: Read, Grep, Glob, Edit, Write, Bash, WebFetch, WebSearch`, "Write docs.\nSecond line.\n");
  test("Codex: name, description and developer_instructions decode to the source", () => {
    const r = convert(writer, "codex");
    assert.equal(r.ext, ".toml");
    const t = decodeToml(r.content);
    assert.deepEqual(t.keys, ["name", "description", "developer_instructions"]);
    assert.deepEqual(t.values, { name: "x-agent", description: "Does a thing.", developer_instructions: "Write docs.\nSecond line.\n" });
  });
  test("Copilot: name, description and the unchanged prompt, as <name>.agent.md", () => {
    const r = convert(writer, "copilot");
    assert.equal(r.ext, ".agent.md");
    const d = decodeMarkdown(r.content);
    assert.deepEqual(d.keys, ["name", "description"]);
    assert.equal(d.body, "Write docs.\nSecond line.\n");
  });
  test("Claude Code: the frontmatter fields and the prompt of the source", () => {
    const r = convert(writer, "claude");
    assert.ok(r.content.startsWith(writer.text));
    assert.equal(inspect(r.content, "md").intact, true);
  });
  test("Gemini adds kind: local; Cursor and Copilot add nothing for an unrestricted agent", () => {
    assert.deepEqual(decodeMarkdown(convert(writer, "gemini").content).keys, ["name", "description", "kind"]);
    assert.deepEqual(decodeMarkdown(convert(writer, "cursor").content).keys, ["name", "description"]);
    assert.deepEqual(decodeMarkdown(convert(writer, "copilot").content).keys, ["name", "description"]);
  });
  test("agents folders per tool and scope", () => {
    const env = { home: "/h", cwd: "/p" };
    const rel = (p) => p.replaceAll("\\", "/");
    assert.deepEqual(
      TOOL_IDS.map((t) => [rel(agentsDir(t, "user", env)), rel(agentsDir(t, "project", env))]),
      [
        ["/h/.claude/agents", "/p/.claude/agents"],
        ["/h/.codex/agents", "/p/.codex/agents"],
        ["/h/.gemini/agents", "/p/.gemini/agents"],
        ["/h/.cursor/agents", "/p/.cursor/agents"],
        ["/h/.copilot/agents", "/p/.github/agents"],
      ],
    );
    assert.deepEqual(TOOL_IDS.map((t) => TOOLS[t].agents.ext), [".md", ".toml", ".md", ".md", ".agent.md"]);
    for (const t of TOOL_IDS) assert.match(TOOLS[t].agents.source, /^https:\/\//);
    assert.deepEqual(agentOverlaps(["claude", "codex", "cursor", "gemini"], "user").map((o) => [o.reader, o.other, o.path]), [
      ["cursor", "claude", "~/.claude/agents"],
      ["cursor", "codex", "~/.codex/agents"],
    ]);
    assert.equal(agentOverlaps(["claude", "cursor"], "project")[0].path, ".claude/agents");
    assert.deepEqual(agentOverlaps(["claude", "copilot"], "user"), []);
  });
});

describe("Fields that do not travel", () => {
  test("model is dropped with a report for gemini, and kept for claude", () => {
    const a = fixture("quick-scout");
    const g = convert(a, "gemini");
    assert.ok(!/model:/.test(g.content));
    assert.ok(g.dropped.includes("model"));
    assert.match(convert(a, "claude").content, /\nmodel: haiku\n/);
    assert.deepEqual(convert(a, "claude").dropped, []);
  });
  test("model: inherit and an absent model are not reported", () => {
    assert.deepEqual(convert(fixture("full-access"), "gemini").dropped, []);
    assert.deepEqual(convert(fixture("readonly-reviewer"), "gemini").dropped, []);
  });
  test("Claude-only fields are dropped for cursor and reported, kept for claude", () => {
    const a = fixture("quick-scout");
    const c = convert(a, "cursor");
    assert.deepEqual(decodeMarkdown(c.content).keys, ["name", "description", "readonly"]);
    assert.deepEqual(c.dropped, ["model", "color", "maxTurns"]);
    assert.match(convert(a, "claude").content, /color: blue/);
  });
  for (const [field, line] of [["hooks", "hooks:\n  PreToolUse:\n    - matcher: Bash"], ["mcpServers", "mcpServers:\n  a:\n    command: x"], ["permissionMode", "permissionMode: bypassPermissions"], ["initialPrompt", "initialPrompt: go"]]) {
    test(`${field} is refused for every tool, claude included, and nothing is produced`, () => {
      for (const tool of TOOL_IDS) {
        const r = convert(agentOf(`${base}\ntools: Read\n${line}`), tool, { allowBroader: true });
        assert.equal(r.ok, false, tool);
        assert.equal(r.field, field);
        assert.equal(r.content, undefined);
        assert.match(r.message, new RegExp(`field "${field}"`));
      }
    });
  }
  test("the skills field is kept for claude and not written for the others", () => {
    const a = fixture("skilled-agent");
    assert.match(convert(a, "claude").content, /skills:\n  - alpha/);
    for (const tool of ["gemini", "cursor", "copilot"]) assert.ok(!/skills/.test(convert(a, tool).content.split("---\n")[1]), tool);
    assert.match(convert(a, "gemini").notes.join("\n"), /alpha installed alongside/);
  });
});

describe("Permissions are never silently widened", () => {
  test("read-only agent for Gemini has tools read_file and grep_search", () => {
    const d = decodeMarkdown(convert(fixture("readonly-reviewer"), "gemini").content);
    assert.deepEqual(d.front.tools, ["read_file", "grep_search"]);
  });
  test("every Gemini translation of the table", () => {
    const a = agentOf(`${base}\ntools: Read, Grep, Glob, Edit, Write, Bash, WebFetch`);
    assert.deepEqual(decodeMarkdown(convert(a, "gemini").content).front.tools, ["read_file", "grep_search", "glob", "replace", "write_file", "run_shell_command", "web_fetch"]);
    const w = agentOf(`${base}\ntools: WebSearch`);
    assert.deepEqual(decodeMarkdown(convert(w, "gemini").content).front.tools, ["google_web_search"]);
  });
  test("read-only agent for Cursor has readonly: true and the note", () => {
    const r = convert(agentOf(`${base}\ntools: Read, Grep, Glob`), "cursor");
    assert.equal(decodeMarkdown(r.content).front.readonly, true);
    assert.ok(r.notes.includes(READ_ONLY_NOTE));
    assert.match(READ_ONLY_NOTE, /also allows commands that do not change state/);
  });
  test("Cursor refuses an agent that can write or run commands, unless it is unrestricted", () => {
    const r = convert(agentOf(`${base}\ntools: Read, Edit`), "cursor");
    assert.equal(r.ok, false);
    assert.match(r.reason, /read-only agent, and the agent can use Edit/);
    assert.equal(convert(fixture("full-access"), "cursor").ok, true);
  });
  test("Copilot writes the effective tools unchanged; never an empty list", () => {
    assert.deepEqual(decodeMarkdown(convert(fixture("readonly-reviewer"), "copilot").content).front.tools, ["Read", "Grep"]);
    const none = convert(agentOf(`${base}\ntools: Read\ndisallowedTools: Read`), "copilot");
    assert.equal(none.ok, false);
    assert.match(none.reason, /no tool is left/);
    assert.equal(convert(agentOf(`${base}\ntools: []`), "copilot").ok, false);
  });
  test("restricted agent for Codex is refused with the reason and the flag", () => {
    const r = convert(fixture("readonly-reviewer"), "codex");
    assert.equal(r.ok, false);
    assert.equal(r.bypassable, true);
    assert.match(r.message, /refused for OpenAI Codex: field "tools": a Codex agent cannot restrict its tools/);
    assert.match(r.message, /--allow-broader-access/);
    assert.equal(r.content, undefined);
  });
  test("with --allow-broader-access Codex gets the file without restriction and the marker says so", () => {
    const r = convert(fixture("readonly-reviewer"), "codex", { allowBroader: true });
    assert.equal(r.ok, true);
    assert.equal(r.broadened, true);
    assert.match(r.broader, /broader access than its source asks/);
    assert.deepEqual(decodeToml(r.content).keys, ["name", "description", "developer_instructions"]);
    assert.match(r.content.trimEnd().split("\n").at(-1), / broadened=tools$/);
    assert.equal(inspect(r.content, "toml").broadened, true);
  });
  test("the flag does nothing to an agent that was already expressible", () => {
    const r = convert(fixture("readonly-reviewer"), "gemini", { allowBroader: true });
    assert.equal(r.broadened, false);
    assert.deepEqual(decodeMarkdown(r.content).front.tools, ["read_file", "grep_search"]);
  });
  test("an unrestricted agent converts for Codex without the flag", () => {
    const r = convert(fixture("full-access"), "codex");
    assert.equal(r.ok, true);
    assert.equal(r.broadened, false);
    assert.ok(!/ broadened=/.test(r.content));
  });
  test("an MCP tool cannot be translated: refused for gemini, copilot, cursor and codex, fine for claude", () => {
    const a = fixture("mcp-agent");
    for (const tool of ["gemini", "copilot", "cursor", "codex"]) {
      const r = convert(a, tool);
      assert.equal(r.ok, false, tool);
      assert.match(r.reason, /mcp__github__search cannot be translated/);
    }
    assert.equal(convert(a, "claude").ok, true);
    assert.equal(convert(a, "gemini", { allowBroader: true }).broadened, true);
  });
  test("a specifier removes the whole tool: gemini gets read_file and grep_search and the note", () => {
    const r = convert(fixture("shell-limited"), "gemini");
    assert.deepEqual(decodeMarkdown(r.content).front.tools, ["read_file", "grep_search"]);
    assert.match(r.notes[0], /"Bash\(rm \*\)" removed the whole Bash tool/);
    assert.match(convert(fixture("shell-limited"), "claude").notes[0], /removed the whole Bash tool/);
  });
  test("an entry with a specifier in tools is unmapped outside claude", () => {
    const r = convert(agentOf(`${base}\ntools: Read, Bash(git log *)`), "copilot");
    assert.equal(r.ok, false);
    assert.match(r.reason, /Bash\(git log \*\) cannot be translated/);
  });
  test("restrictionFor is a pure table", () => {
    assert.deepEqual(restrictionFor("claude", ["Read"]), { mode: "native" });
    assert.equal(restrictionFor("codex", ["Read"]).mode, "refuse");
    assert.equal(restrictionFor("nope", ["Read"]).mode, "refuse");
    assert.deepEqual(effectiveTools(["Read", "Bash(x)"], ["Bash"]).effective, ["Read"]);
  });
});

describe("Install marker", () => {
  const body = "---\nname: a\n---\nPrompt.\n";
  test("stamp appends a marker whose hash covers the content before it", () => {
    const text = stamp(body, "md", { version: VERSION });
    assert.equal(text, `${body}${markerLine("md", body, { version: VERSION })}\n`);
    assert.match(text, /\n<!-- agent-skills: sha256=[0-9a-f]{64} version=1\.2\.3 -->\n$/);
    assert.deepEqual(inspect(text, "md"), { marked: true, intact: true, version: VERSION, broadened: false });
    assert.equal(inspect(text, "md").intact, text.split("<!--")[0] && sha256(body) === text.match(/sha256=([0-9a-f]{64})/)[1]);
  });
  test("TOML uses a comment, Markdown an HTML comment, and each only matches its own format", () => {
    const toml = stamp('name = "a"\n', "toml", { version: VERSION, broadened: true });
    assert.match(toml, /\n# agent-skills: sha256=[0-9a-f]{64} version=1\.2\.3 broadened=tools\n$/);
    assert.equal(inspect(toml, "toml").broadened, true);
    assert.equal(inspect(toml, "md").marked, false);
    assert.equal(inspect(stamp(body, "md", { version: VERSION }), "toml").marked, false);
  });
  test("a CRLF-only change keeps the file intact", () => {
    const text = stamp(body, "md", { version: VERSION });
    assert.equal(inspect(text.replace(/\n/g, "\r\n"), "md").intact, true);
    assert.equal(inspect("\uFEFF" + text.replace(/\n/g, "\r\n") + "\r\n\r\n", "md").intact, true);
  });
  test("an edited file has a marker but is not intact", () => {
    const text = stamp(body, "md", { version: VERSION }).replace("Prompt.", "Prompt, edited.");
    assert.deepEqual([inspect(text, "md").marked, inspect(text, "md").intact], [true, false]);
  });
  test("a forged hash is not intact; a malformed marker is no marker", () => {
    const forged = `${body}<!-- agent-skills: sha256=${"0".repeat(64)} version=1.0.0 -->\n`;
    assert.deepEqual([inspect(forged, "md").marked, inspect(forged, "md").intact], [true, false]);
    for (const bad of [
      `<!-- agent-skills: sha256=${"0".repeat(63)} version=1.0.0 -->`,
      `<!-- agent-skills: sha256=${"g".repeat(64)} version=1.0.0 -->`,
      `<!-- agent-skills: sha256=${"0".repeat(65)} version=1.0.0 -->`,
      `<!-- agent-skills: sha256=${"0".repeat(64)} version=1 0 -->`,
      `<!-- agent-skills: sha256=${"0".repeat(64)} version=1.0.0 broadened=everything -->`,
      `<!-- agent-skills: sha256=${"0".repeat(64)} version=1.0.0 --> trailing`,
      ` <!-- agent-skills: sha256=${"0".repeat(64)} version=1.0.0 -->x`,
      `<!--agent-skills: sha256=${"0".repeat(64)} version=1.0.0-->`,
    ])
      assert.equal(inspect(`${body}${bad}\n`, "md").marked, false, bad);
  });
  test("the marker counts only on the last non-empty line", () => {
    const text = stamp(body, "md", { version: VERSION }) + "More text.\n";
    assert.equal(inspect(text, "md").marked, false);
    assert.equal(inspect("", "md").marked, false);
    assert.equal(inspect("\n\n", "md").marked, false);
  });
  test("a version that is not made of [0-9A-Za-z.+-] cannot be written", () => {
    assert.throws(() => markerLine("md", body, { version: "1.0 -->" }), RangeError);
  });
});

describe("Values are escaped, not concatenated", () => {
  const hostile = [
    'x\ntools: ["*"]',
    "a: b",
    "# not a comment",
    "---",
    "- item",
    "&anchor",
    "*alias",
    "!!str tagged",
    'say "hi"',
    "back\\slash and trailing\\",
    '"""',
    "true",
    "null",
    "1e3",
    "line\u2028sep and para\u2029sep and nel\u0085x",
    "tab\there",
    "bell\u0007 del\u007f",
    "'single'",
    "emoji \u{1F600} and caf\u00e9",
    "key: value\n---\nname: evil",
    "[a, b]",
    "{a: b}",
  ];
  const prompts = [
    ...hostile,
    "line one\n\nline three\n",
    'ends with a backslash \\',
    'quotes """ and "" and " and \\"""',
    "\n\nleading newlines\n",
    "control \u0001 \u001f chars",
    "windows\r\nline endings are normalized elsewhere",
  ];
  const MD_TOOLS = ["gemini", "cursor", "copilot"];

  test("Markdown outputs: one description value, only the keys the converter writes", () => {
    for (const description of hostile) {
      for (const tool of MD_TOOLS) {
        const source = agentFromText(`---\nname: x-agent\ndescription: ${JSON.stringify(description)}\ntools: Read, Grep\n---\nPrompt.\n`);
        assert.equal(source.description, description, "the source decodes to the hostile value");
        const r = convert(source, tool);
        assert.ok(r.ok, `${tool}: ${r.message}`);
        const d = decodeMarkdown(r.content);
        assert.equal(d.front.description, description, `${tool}: ${JSON.stringify(description)}`);
        const expected = { gemini: ["name", "description", "kind", "tools"], cursor: ["name", "description", "readonly"], copilot: ["name", "description", "tools"] }[tool];
        assert.deepEqual(d.keys, expected, `${tool} must not gain keys from ${JSON.stringify(description)}`);
      }
    }
  });
  test("the description that tries to add a tools key stays one value (Copilot)", () => {
    const source = agentFromText(`---\nname: x-agent\ndescription: ${JSON.stringify('x\ntools: ["*"]')}\ntools: Read\n---\nPrompt.\n`);
    const d = decodeMarkdown(convert(source, "copilot").content);
    assert.equal(d.front.description, 'x\ntools: ["*"]');
    assert.equal(d.keys.filter((k) => k === "tools").length, 1);
    assert.deepEqual(d.front.tools, ["Read"]);
    assert.equal(d.content, undefined);
    assert.equal(convert(source, "copilot").content.split("\n").filter((l) => l.startsWith("tools:")).length, 1);
  });
  test("Codex: name, description and prompt round-trip exactly", () => {
    for (const description of hostile) {
      for (const prompt of prompts) {
        const source = agentFromText(`---\nname: x-agent\ndescription: ${JSON.stringify(description)}\ntools: Read, Grep, Glob, Edit, Write, Bash, WebFetch, WebSearch\n---\n${prompt}`);
        const r = convert(source, "codex");
        const t = decodeToml(r.content);
        assert.deepEqual(t.keys, ["name", "description", "developer_instructions"]);
        assert.equal(t.values.description, description);
        assert.equal(t.values.developer_instructions, source.body, JSON.stringify(prompt));
        assert.equal(t.values.name, "x-agent");
      }
    }
  });
  test("Markdown outputs carry the prompt unchanged, line endings aside", () => {
    for (const prompt of prompts) {
      for (const tool of MD_TOOLS) {
        const source = agentFromText(`---\nname: x-agent\ndescription: d\ntools: Read, Grep\n---\n${prompt}`);
        const d = decodeMarkdown(convert(source, tool).content);
        assert.equal(d.body, source.body.endsWith("\n") ? source.body : source.body + "\n", `${tool}: ${JSON.stringify(prompt)}`);
      }
    }
  });
  test("the serializers refuse a lone surrogate, and the converter refuses the agent", () => {
    assert.throws(() => yamlString("a\uD800b"), RangeError);
    assert.throws(() => tomlString("a\uDC00"), RangeError);
    assert.throws(() => tomlMultiline("\uD83D"), RangeError);
    const source = agentFromText("---\nname: x-agent\ndescription: d\ntools: Read\n---\nPrompt.\n");
    source.description = "bad \uD800";
    for (const tool of TOOL_IDS) assert.equal(convert(source, tool).ok, false, tool);
  });
  test("the serializers write the escapes the design promises", () => {
    assert.equal(yamlString("a\u2028b\u2029c\u0085d\u007fe\n"), '"a\\u2028b\\u2029c\\u0085d\\u007Fe\\n"');
    assert.equal(tomlString('a"b\\c\n'), '"a\\"b\\\\c\\n"');
    assert.equal(tomlMultiline('x\n"""\\\n'), '"""\nx\n\\"\\"\\"\\\\\n"""');
  });
  test("names that are not safe never reach an output", () => {
    for (const name of ["../../.bashrc", "aux", "Has Space", "a".repeat(65), "", "con"]) {
      const source = agentFromText("---\nname: x-agent\ndescription: d\ntools: Read\n---\nPrompt.\n");
      source.name = name;
      for (const tool of TOOL_IDS) {
        const r = convert(source, tool, { allowBroader: true });
        assert.equal(r.ok, false, `${tool} ${name}`);
        assert.equal(r.field, "name");
      }
    }
  });
});

test("an agent that depends on a skill that is not in the catalog is refused for every tool", () => {
  for (const tool of TOOL_IDS) {
    const r = convert(fixture("skilled-agent"), tool, { knownSkills: new Set(["beta"]), allowBroader: true });
    assert.equal(r.ok, false, tool);
    assert.equal(r.field, "skills");
  }
  assert.equal(convert(fixture("skilled-agent"), "claude", { knownSkills: new Set(["alpha"]) }).ok, true);
});

describe("Defense in depth for characters (review cycle 1)", () => {
  const bidi = ["\u202a", "\u202e", "\u2066", "\u2069"];
  const base = (extra) => `---\nname: x-agent\ndescription: ${extra.description ?? "d"}\ntools: Read\n---\n${extra.body ?? "Prompt.\n"}`;
  test("a bidirectional control character anywhere in the source is refused for every tool", () => {
    for (const ch of bidi) {
      for (const text of [base({ description: JSON.stringify(`a${ch}b`) }), base({ body: `Prompt ${ch} text\n` })]) {
        for (const tool of TOOL_IDS) {
          const r = convert(agentFromText(text), tool, { allowBroader: true });
          assert.equal(r.ok, false, `${tool} ${JSON.stringify(ch)}`);
          assert.match(r.message, /bidirectional control character/);
        }
      }
    }
  });
  test("the serializers escape bidirectional characters too", () => {
    for (const ch of bidi) {
      assert.ok(!yamlString(`a${ch}b`).includes(ch));
      assert.ok(!tomlString(`a${ch}b`).includes(ch));
      assert.ok(!tomlMultiline(`a${ch}b`).includes(ch));
    }
    assert.equal(JSON.parse(yamlString("a\u202eb")), "a\u202eb");
  });
  test("line breaks and control characters in the description stay one escaped value", () => {
    for (const ch of ["\n", "\u0085", "\u2028", "\u2029", "\u0007"]) {
      const a = agentFromText(base({ description: JSON.stringify(`a${ch}b`) }));
      for (const tool of ["gemini", "cursor", "copilot"]) assert.equal(decodeMarkdown(convert(a, tool).content).front.description, `a${ch}b`);
      assert.equal(decodeToml(convert(a, "codex", { allowBroader: true }).content).values.description, `a${ch}b`);
    }
  });
});
