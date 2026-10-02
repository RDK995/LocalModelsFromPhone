import { describe, it, expect } from "bun:test";
import { deepResearchAction } from "./deepResearch";

const resident = (name: string) => ({ name, loaded_by_server: true });

describe("deepResearchAction", () => {
  it("is hidden when the web switch is off, whatever the model", () => {
    const state = { resident: resident("qwen3.5:35b-a3b"), deep_research_model: "qwen3.5:35b-a3b" };
    expect(deepResearchAction(false, state)).toEqual({
      visible: false,
      enabled: false,
      explanation: null,
    });
    expect(deepResearchAction(false, null).visible).toBe(false);
  });

  it("is enabled when the resident model is the deep research model", () => {
    expect(
      deepResearchAction(true, {
        resident: resident("qwen3.5:35b-a3b"),
        deep_research_model: "qwen3.5:35b-a3b",
      })
    ).toEqual({ visible: true, enabled: true, explanation: null });
  });

  it("is disabled and names the model when another model is resident", () => {
    expect(
      deepResearchAction(true, {
        resident: resident("llama3"),
        deep_research_model: "qwen3.5:35b-a3b",
      })
    ).toEqual({
      visible: true,
      enabled: false,
      explanation: "Load qwen3.5:35b-a3b to use deep research",
    });
  });

  it("is disabled and names the model when none is resident", () => {
    expect(
      deepResearchAction(true, { resident: null, deep_research_model: "qwen3.5:35b-a3b" })
    ).toEqual({
      visible: true,
      enabled: false,
      explanation: "Load qwen3.5:35b-a3b to use deep research",
    });
  });

  it("hardcodes no model name", () => {
    expect(
      deepResearchAction(true, { resident: resident("some-other:7b"), deep_research_model: "some-other:7b" }).enabled
    ).toBe(true);
    expect(
      deepResearchAction(true, { resident: resident("qwen3.5:35b-a3b"), deep_research_model: "some-other:7b" })
    ).toEqual({
      visible: true,
      enabled: false,
      explanation: "Load some-other:7b to use deep research",
    });
  });

  it("is disabled with a plain line when the state or model name is unknown", () => {
    const unknown = {
      visible: true,
      enabled: false,
      explanation: "Can't tell which model deep research uses.",
    };
    expect(deepResearchAction(true, null)).toEqual(unknown);
    expect(deepResearchAction(true, { resident: resident("llama3") })).toEqual(unknown);
  });
});
