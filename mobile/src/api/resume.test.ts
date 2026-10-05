/**
 * Unit tests for the resume backoff schedule and budget constant, in
 * isolation from `APIClient` (see client.test.ts for the resume loop's
 * behavioural tests, which assert on these values via an injected fake
 * sleep/clock).
 */

import { describe, it, expect } from "bun:test";
import { resumeDelayMs, RESUME_BUDGET_MS } from "./resume";

describe("resumeDelayMs", () => {
  it("follows the fixed 500/1000/2000/4000/8000ms schedule for attempts 1..5", () => {
    expect([1, 2, 3, 4, 5].map(resumeDelayMs)).toEqual([
      500, 1000, 2000, 4000, 8000,
    ]);
  });

  it("caps at 10000ms for every attempt after the fifth", () => {
    expect([6, 7, 20, 1000].map(resumeDelayMs)).toEqual([
      10000, 10000, 10000, 10000,
    ]);
  });
});

describe("RESUME_BUDGET_MS", () => {
  it("is 300000ms (5 minutes)", () => {
    expect(RESUME_BUDGET_MS).toBe(300_000);
  });
});
