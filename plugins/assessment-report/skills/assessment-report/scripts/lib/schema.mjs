// In-house validator for the subset of JSON Schema that schema/assessment.schema.json uses:
// type, enum, const, pattern, minLength, minimum, maximum, required, properties, additionalProperties,
// items, minItems, maxItems, $ref (local), allOf, if/then/not, and the boolean schema `false`.
// Every error carries the field path, so a failing fixture can be asserted by path.
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

export const SCHEMA_PATH = fileURLToPath(new URL("../../schema/assessment.schema.json", import.meta.url));
let cached;
export function loadSchema() {
  return (cached ??= JSON.parse(readFileSync(SCHEMA_PATH, "utf8")));
}

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const isType = (v, t) => (t === "number" ? typeof v === "number" : t === "integer" ? Number.isInteger(v) : typeOf(v) === t);
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
  return ref.slice(2).split("/").reduce((n, k) => n[k], root);
}

function validate(root, schema, value, path, errors) {
  if (schema === true) return;
  if (schema === false) return errors.push({ path, message: "is not allowed here" });
  if (schema.$ref) return validate(root, resolveRef(root, schema.$ref), value, path, errors);

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => isType(value, t))) return errors.push({ path, message: `must be ${types.join(" or ")}, got ${typeOf(value)}` });
  }
  if ("const" in schema && !deepEq(value, schema.const)) errors.push({ path, message: `must be ${JSON.stringify(schema.const)}` });
  if (schema.enum && !schema.enum.some((e) => deepEq(e, value)))
    errors.push({ path, message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}` });

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: value.length ? `must have at least ${schema.minLength} characters` : "must not be empty" });
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path, message: `must match ${schema.pattern}` });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `must be at least ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: `must be at most ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: `must have at least ${schema.minItems} item(s)` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, message: `must have at most ${schema.maxItems} item(s)` });
    if (schema.items) value.forEach((v, i) => validate(root, schema.items, v, `${path}[${i}]`, errors));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push({ path: path ? `${path}.${k}` : k, message: "is required" });
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      if (k in props) validate(root, props[k], v, p, errors);
      else if (schema.additionalProperties === false) errors.push({ path: p, message: "is not a known field" });
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validate(root, schema.additionalProperties, v, p, errors);
    }
  }
  for (const sub of schema.allOf ?? []) validate(root, sub, value, path, errors);
  if (schema.if) {
    const probe = [];
    validate(root, schema.if, value, path, probe);
    if (!probe.length && schema.then) validate(root, schema.then, value, path, errors);
  }
  if (schema.not) {
    const probe = [];
    validate(root, schema.not, value, path, probe);
    if (!probe.length) errors.push({ path, message: "matches a form that is not allowed" });
  }
}

/** @returns {{path: string, message: string}[]} empty when valid */
export function validateAssessment(data, schema = loadSchema()) {
  const errors = [];
  validate(schema, schema, data, "", errors);
  return errors.map((e) => ({ path: e.path || "(root)", message: e.message }));
}
