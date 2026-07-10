import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guards against OpenAPI drift: EVERY Express route mounted under /api must be
// documented in lib/api-spec/openapi.yaml. The spec reached full coverage with
// issue #12 (the last 24 known gaps were documented and the escape-hatch list
// emptied) — new routes must ship with their spec entry in the same change.
const KNOWN_UNDOCUMENTED = new Set<string>([]);

const here = path.dirname(fileURLToPath(import.meta.url));
const routesDir = here;
const specPath = path.resolve(here, "../../../../lib/api-spec/openapi.yaml");

function implementedPaths(): Set<string> {
  const paths = new Set<string>();
  for (const file of fs.readdirSync(routesDir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const src = fs.readFileSync(path.join(routesDir, file), "utf8");
    for (const m of src.matchAll(/router\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)) {
      // Normalize Express `:param` to OpenAPI `{param}`.
      paths.add(m[2].replace(/:([A-Za-z0-9_]+)/g, "{$1}"));
    }
  }
  return paths;
}

function documentedPaths(): Set<string> {
  const spec = fs.readFileSync(specPath, "utf8");
  return new Set([...spec.matchAll(/^ {2}(\/\S+):/gm)].map((m) => m[1]));
}

describe("OpenAPI route coverage", () => {
  it("has no new undocumented routes", () => {
    const documented = documentedPaths();
    const undocumented = [...implementedPaths()].filter(
      (p) => !documented.has(p) && !KNOWN_UNDOCUMENTED.has(p),
    );
    expect(
      undocumented,
      `These routes are implemented but not in openapi.yaml. Document them (and, if resolving a known gap, remove from KNOWN_UNDOCUMENTED): ${undocumented.join(", ")}`,
    ).toEqual([]);
  });

  it("does not list already-documented paths as known gaps", () => {
    const documented = documentedPaths();
    const stale = [...KNOWN_UNDOCUMENTED].filter((p) => documented.has(p));
    expect(stale, `These paths are now documented — remove them from KNOWN_UNDOCUMENTED: ${stale.join(", ")}`).toEqual([]);
  });
});
