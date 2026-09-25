/**
 * Regression test for the "keyboard covers the action button" defect
 * (.harness/reviews/M1-cycle2.md finding B, fix cycle 3): on Setup, Settings
 * and Chat the on-screen keyboard covered the screen's action button(s) and
 * could not be dismissed by tapping outside the input.
 *
 * This checks each route file statically (source text) rather than
 * importing/rendering it: src/app/*.tsx imports "expo-router" and,
 * transitively via secureStoreToken, "expo-secure-store", both of which pull
 * in react-native's Flow-typed sources that bun's test runner cannot parse
 * (see the comment atop src/api/secureStoreToken.ts and
 * src/app-routing/rootIndexRoute.test.ts).
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readScreen(name: string): string {
  return readFileSync(
    join(import.meta.dir, "..", "app", name),
    "utf-8"
  );
}

/**
 * A screen has a working dismiss mechanism if it either calls
 * Keyboard.dismiss directly, or combines keyboardShouldPersistTaps with a
 * keyboardDismissMode on a scrollable so dragging/tapping the scrollable
 * closes the keyboard while inner touchables still register taps.
 */
function hasDismissMechanism(source: string): boolean {
  const callsKeyboardDismiss = /Keyboard\.dismiss/.test(source);
  const hasPersistTaps = /keyboardShouldPersistTaps/.test(source);
  const hasDismissMode = /keyboardDismissMode/.test(source);
  return callsKeyboardDismiss || (hasPersistTaps && hasDismissMode);
}

describe("keyboard handling on Setup, Settings and Chat", () => {
  it("setup.tsx uses KeyboardAvoidingView, has a dismiss mechanism, and a single-line token field with onSubmitEditing", () => {
    const source = readScreen("setup.tsx");

    expect(source).toMatch(/KeyboardAvoidingView/);
    expect(hasDismissMechanism(source)).toBe(true);
    expect(source).not.toMatch(/multiline={?true}?/);
    expect(source).toMatch(/onSubmitEditing=/);
  });

  it("settings.tsx uses KeyboardAvoidingView, has a dismiss mechanism, and a single-line token field with onSubmitEditing", () => {
    const source = readScreen("settings.tsx");

    expect(source).toMatch(/KeyboardAvoidingView/);
    expect(hasDismissMechanism(source)).toBe(true);
    expect(source).not.toMatch(/multiline={?true}?/);
    expect(source).toMatch(/onSubmitEditing=/);
  });

  it("chat.tsx uses KeyboardAvoidingView and has a dismiss mechanism for the message list", () => {
    const source = readScreen("chat.tsx");

    expect(source).toMatch(/KeyboardAvoidingView/);
    expect(hasDismissMechanism(source)).toBe(true);
  });
});
