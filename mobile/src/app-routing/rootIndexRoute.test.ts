/**
 * Regression test for the "Unmatched Route" defect (.harness/reviews/M1-cycle2.md
 * finding B): Expo Go and expo-router both open the project at "/". Without a
 * src/app/index.tsx file, "/" matches no route and expo-router renders its
 * "Unmatched Route" screen instead of ever reaching Chat or Setup.
 *
 * This checks the route file statically (path exists, has a default-exported
 * function) rather than importing it: src/app/index.tsx imports
 * "expo-router" and, transitively via secureStoreToken, "expo-secure-store",
 * both of which pull in react-native's Flow-typed sources that bun's test
 * runner cannot parse (see the comment atop src/api/secureStoreToken.ts).
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("root index route", () => {
  it("has an index.tsx under src/app with a function default export", () => {
    const appDir = join(import.meta.dir, "..", "app");
    const files = readdirSync(appDir);

    expect(files).toContain("index.tsx");

    const source = readFileSync(join(appDir, "index.tsx"), "utf-8");
    expect(source).toMatch(/export default function/);
  });
});
