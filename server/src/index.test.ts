import { describe, it, expect } from "bun:test";
import { parseResearchBudget } from "./index";

describe("parseResearchBudget", () => {
  it("parses valid positive integers", () => {
    expect(parseResearchBudget("600000")).toBe(600000);
  });

  it("trims whitespace before parsing", () => {
    expect(parseResearchBudget(" 1000 ")).toBe(1000);
  });

  it("returns undefined for undefined input", () => {
    expect(parseResearchBudget(undefined)).toBe(undefined);
  });

  it("returns undefined for empty string", () => {
    expect(parseResearchBudget("")).toBe(undefined);
  });

  it("returns undefined for zero", () => {
    expect(parseResearchBudget("0")).toBe(undefined);
  });

  it("returns undefined for negative numbers", () => {
    expect(parseResearchBudget("-5")).toBe(undefined);
  });

  it("returns undefined for non-numeric strings", () => {
    expect(parseResearchBudget("abc")).toBe(undefined);
  });

  it("returns undefined for scientific notation", () => {
    expect(parseResearchBudget("1e3")).toBe(undefined);
  });

  it("returns undefined for values beyond safe integers", () => {
    expect(parseResearchBudget("99999999999999999999")).toBe(undefined);
  });
});
