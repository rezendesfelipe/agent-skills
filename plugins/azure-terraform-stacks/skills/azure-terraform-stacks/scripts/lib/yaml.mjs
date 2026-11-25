// The one place the engine reaches the YAML parser. It is a byte-for-byte copy of the npm package `yaml` (see
// scripts/vendor/yaml/PROVENANCE.json), so the engine needs no `npm ci`. The copy is CommonJS: Node reads it that way
// because scripts/vendor/yaml/package.json says "type": "commonjs", while this skill's own package.json says "module".
import YAML from "../vendor/yaml/dist/index.js";
export default YAML;
