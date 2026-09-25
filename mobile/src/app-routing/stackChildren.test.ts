/**
 * Regression test for the launch crash "TypeError: Cannot convert Symbol to
 * string" in RootLayout (M1-C11, .harness/reviews/M1-cycle2.md finding B,
 * fix cycle 4).
 *
 * expo-router's <Stack> maps its children with React.Children.toArray, which
 * does not look inside a Fragment. A Fragment child falls through to the
 * "Unknown child element passed to Stack: ${child.type}" warning, and a
 * Fragment's type is a Symbol, so the template literal throws. The
 * token-present branch of RootLayout wrapped its Stack.Screens in `<>`, so
 * every launch with a stored token crashed before any screen rendered.
 *
 * Checked statically (bun cannot render React Native; see
 * rootIndexRoute.test.ts). The behavioural check is scripts/runtime-smoke.sh.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "..", "app", "_layout.tsx"),
  "utf-8"
);
const stackBody = source.slice(
  source.indexOf("<Stack"),
  source.lastIndexOf("</Stack>")
);

describe("RootLayout <Stack> children", () => {
  it("are not wrapped in a Fragment (expo-router's Stack cannot map one)", () => {
    expect(stackBody.length).toBeGreaterThan(0);
    expect(stackBody).not.toMatch(/<>|<\/>|<(React\.)?Fragment\b/);
  });

  it("still declares the chat, settings and setup screens", () => {
    for (const name of ["chat", "settings", "setup"]) {
      expect(stackBody).toContain(`name="${name}"`);
    }
  });
});
