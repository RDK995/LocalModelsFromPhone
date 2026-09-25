/**
 * Behavioural tests for the root route decision used by src/app/index.tsx.
 */

import { describe, it, expect } from "bun:test";
import { initialRoute } from "./initialRoute";

describe("initialRoute", () => {
  it("goes to chat when a token is present", () => {
    expect(initialRoute("some-token")).toBe("/chat");
  });

  it("goes to setup when there is no token", () => {
    expect(initialRoute(null)).toBe("/setup");
  });
});
