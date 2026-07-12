#!/usr/bin/env node
/**
 * External-review item 4, the PROCESS half — "stored, rendered, never
 * consulted" recurred (quorum in 2.x, deadlineBehavior in 3.x). This check
 * makes the bug class mechanical: every enum-typed schema column must be READ
 * IN A DECISION somewhere in server code — a comparison, a switch, a nullish
 * default feeding logic — not merely written at insert time and interpolated
 * into display strings.
 *
 * Heuristic, and honest about it:
 *   - a "decision read" = a non-test server line that mentions the property
 *     name together with ===, !==, case, switch, ??, startsWith or includes;
 *   - generic property names (status, type, role…) collide across tables, so
 *     a dead column with a popular name can hide behind a live namesake. The
 *     check still catches the distinctive names — which is exactly the class
 *     that shipped twice.
 *
 * Run: node scripts/check-dead-config.mjs   (CI runs it with the tests)
 * Exit 0 = every enum column is consulted somewhere; 1 = dead config found.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const schemaDir = path.join(repoRoot, "lib/db/src/schema");
const srcDir = path.join(here, "../src");

// Columns whose "decision read" legitimately lives outside this server's src
// (add sparingly, with a reason).
const ALLOWLIST = new Set([
  // Decision RECORDS, not pending config: the branch happens at write time on
  // the incoming value (tasks.ts evidence review); the column persists the
  // outcome already applied. Nothing promised is left unfired.
  "aiVerdict",
  "secretaryDecision",
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

// 1. Collect enum-typed column property names from the schema package.
const enumProps = new Map(); // prop -> [schemaFile:line]
for (const file of fs.readdirSync(schemaDir).filter((f) => f.endsWith(".ts"))) {
  const lines = fs.readFileSync(path.join(schemaDir, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(\w+):\s*text\("[^"]+",\s*\{\s*enum:/);
    if (m) {
      const prop = m[1];
      if (!enumProps.has(prop)) enumProps.set(prop, []);
      enumProps.get(prop).push(`${file}:${i + 1}`);
    }
  });
}

// 2. Scan server source for decision reads of each property.
const DECISION = /(===|!==|\bcase\s|\bswitch\s*\(|\?\?|\.startsWith\(|\.includes\()/;
const srcFiles = walk(srcDir).map((f) => ({ f, text: fs.readFileSync(f, "utf8") }));

const dead = [];
for (const [prop, definedAt] of enumProps) {
  if (ALLOWLIST.has(prop)) continue;
  const consulted = srcFiles.some(({ text }) =>
    text.split("\n").some((line) => line.includes(prop) && DECISION.test(line)),
  );
  if (!consulted) dead.push({ prop, definedAt });
}

if (dead.length) {
  console.error("DEAD CONFIG: enum columns that are stored (and possibly displayed) but never consulted in a decision:\n");
  for (const d of dead) {
    console.error(`  - ${d.prop}  (defined at ${d.definedAt.join(", ")})`);
  }
  console.error(
    "\nEither wire the column into the behavior it promises, remove it, or allowlist it here with a reason.\n" +
      "(This is the 'quorum was stored and displayed but never consulted' bug class — twice shipped, now checked.)",
  );
  process.exit(1);
}
console.log(`dead-config check: ${enumProps.size} enum columns all consulted in decisions.`);
