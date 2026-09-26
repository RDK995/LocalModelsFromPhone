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

  it("still declares the chat, settings, setup, models and conversations screens", () => {
    for (const name of ["chat", "settings", "setup", "models", "conversations"]) {
      expect(stackBody).toContain(`name="${name}"`);
    }
  });

  it("declares chat, settings and setup unconditionally (M1-C12)", () => {
    // RootLayout used to read the token once at launch and gate the
    // Stack.Screen children on it: `hasToken && <Stack.Screen name="chat" .../>`,
    // `!hasToken && <Stack.Screen name="setup" .../>`. Routing by token is
    // done by app/index.tsx (Redirect) and by the screens' own
    // `router.replace` calls, not by which screens RootLayout declares. When
    // setup.tsx saved a token and called `router.replace("/chat")`, `hasToken`
    // was still false from launch, so "chat"/"settings" were never declared
    // and their options (chat's `headerShown: false`, titles) never applied:
    // Chat and Settings got a second, default Stack header on top of their
    // own (.harness/reviews/M1-cycle2.md finding B, fix cycle 4). Each
    // Stack.Screen must therefore be a direct child of <Stack>, not gated by
    // `&&` / `? :` on any variable.
    const screenStarts = [...stackBody.matchAll(/<Stack\.Screen\b/g)].map(
      m => m.index as number
    );
    expect(screenStarts.length).toBe(5);
    for (const idx of screenStarts) {
      // The nearest preceding non-whitespace token must not be a
      // conditional-rendering operator (&&, the truthy/falsy side of a
      // ternary, or JSX's `{cond ? <A/> : <B/>}`).
      const before = stackBody.slice(0, idx).trimEnd();
      expect(before).not.toMatch(/(&&|\?|:)$/);
    }
    expect(stackBody).not.toMatch(/\bhasToken\b/);
  });
});
