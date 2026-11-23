// Rewrites test/golden-findings.json from the current `check`. Review the diff before committing.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { HERE } from "./helpers.mjs";
import { allScenarios } from "./golden-findings-lib.mjs";

writeFileSync(join(HERE, "golden-findings.json"), JSON.stringify(allScenarios(), null, 1) + "\n");
console.log("golden-findings.json updated");
