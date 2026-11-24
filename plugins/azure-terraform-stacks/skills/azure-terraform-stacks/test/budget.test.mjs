// Budget for the SKILL.md that the stacks-auditor agent preloads (`skills: [azure-terraform-stacks]` injects the
// whole file into the subagent's context at startup). This is a GROWTH GUARD, not a measurement.
//
// The estimate is an APPROXIMATION: UTF-8 bytes divided by 4, rounded up. No offline tokenizer is accurate for
// current Claude models (the vendor calls @anthropic-ai/tokenizer "a very rough approximation" even for Claude 3,
// and it is archived), and adding one would be a new dependency. The official count is the endpoint
// POST /v1/messages/count_tokens (https://platform.claude.com/docs/en/build-with-claude/token-counting), which needs
// an API key: the maintainer runs it (task 5.2 of the OpenSpec change fix-stacks-auditor-agent), never CI.
//
// Last official count, to be filled in by the maintainer. Do not write a number here that was not returned by the
// endpoint. Raising BUDGET needs a new official count.
//   model:          (not counted yet)
//   date:           (not counted yet)
//   method:         POST /v1/messages/count_tokens
//   input_tokens:   (not counted yet) for SKILL.md; agents/stacks-auditor.md; both together
//   estimate then:  (fill in next to the official number)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HERE } from "./helpers.mjs";

export const BUDGET = 3500; // estimated tokens (bytes / 4), about 14,000 bytes; first value proposed by the change, the maintainer fixes it after the official count
const SKILL_MD = join(HERE, "..", "SKILL.md");

/** Line endings differ by checkout (CRLF on Windows adds about one byte per line), so the text is counted as LF, without a BOM. */
export const asLf = (text) => text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

/** APPROXIMATION: UTF-8 bytes / 4, rounded up. Not a tokenizer count. */
export const estimateTokens = (text) => Math.ceil(Buffer.byteLength(asLf(text), "utf8") / 4);

export function checkBudget(text, name = "SKILL.md") {
  const est = estimateTokens(text);
  return est <= BUDGET
    ? { ok: true, est }
    : {
        ok: false,
        est,
        message: `${name} is about ${est} tokens by the offline estimate (bytes / 4, an APPROXIMATION, not a tokenizer count), above the budget of ${BUDGET}. ` +
          `The skill is preloaded into the stacks-auditor's context, so growth has a cost. Shorten the file, or raise BUDGET only after a new official count with POST /v1/messages/count_tokens (needs an API key; see this file's header).`,
      };
}

test("the preloaded SKILL.md is within the budget (estimate is an approximation: bytes / 4)", (t) => {
  const text = asLf(readFileSync(SKILL_MD, "utf8"));
  const r = checkBudget(text);
  t.diagnostic(`SKILL.md: ${Buffer.byteLength(text, "utf8")} bytes (LF), about ${r.est} tokens by the offline estimate (APPROXIMATION, bytes / 4); budget ${BUDGET}; official count: not made yet`);
  assert.ok(r.ok, r.message);
});

test("the budget check fails when about 2,000 bytes of text are appended, and says the number is approximate", () => {
  const text = readFileSync(SKILL_MD, "utf8") + "\n" + "word ".repeat(400);
  const r = checkBudget(text);
  assert.equal(r.ok, false);
  assert.match(r.message, /SKILL\.md/);
  assert.match(r.message, /APPROXIMATION/);
  assert.match(r.message, /raise BUDGET only after a new official count/);
});

test("the estimate does not depend on the checkout's line endings: LF, CRLF and CR give the same number", () => {
  const raw = readFileSync(SKILL_MD, "utf8");
  const lfText = asLf(raw);
  const crlf = lfText.replace(/\n/g, "\r\n");
  assert.ok(Buffer.byteLength(crlf) > Buffer.byteLength(lfText), "CRLF has more bytes");
  assert.equal(estimateTokens(crlf), estimateTokens(lfText));
  assert.equal(estimateTokens(lfText.replace(/\n/g, "\r")), estimateTokens(lfText));
  assert.equal(estimateTokens("\uFEFF" + lfText), estimateTokens(lfText));
  assert.equal(checkBudget(crlf).ok, checkBudget(lfText).ok);
});

test("the estimate is bytes over 4 rounded up, counting UTF-8 bytes and not characters", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens("é"), 1); // 2 bytes
  assert.equal(estimateTokens("ééé"), 2); // 6 bytes
});
