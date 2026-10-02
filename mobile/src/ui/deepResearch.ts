/**
 * Pure view-model for the "Deep research" action beside Send (M18, FR34).
 * The deep-research model name comes from `GET /v1/state`
 * (`deep_research_model`); nothing here hardcodes it.
 */

import type { ResidentModel } from "@shared/api";

export interface DeepResearchAction {
  visible: boolean;
  enabled: boolean;
  explanation: string | null;
}

export interface DeepResearchStateInput {
  resident: ResidentModel | null | undefined;
  deep_research_model?: string;
}

export const DEEP_RESEARCH_NEEDS_WEB_MESSAGE =
  "Deep research needs web search to be on.";

export const DEEP_RESEARCH_UNKNOWN_MODEL_MESSAGE =
  "Can't tell which model deep research uses.";

export function loadDeepResearchModelMessage(model: string): string {
  return `Load ${model} to use deep research`;
}

/**
 * Hidden while the web switch (as displayed) is off; otherwise shown, enabled
 * only when the resident model is the one the server reports for deep research.
 */
export function deepResearchAction(
  webOn: boolean,
  state: DeepResearchStateInput | null | undefined
): DeepResearchAction {
  if (!webOn) {
    return { visible: false, enabled: false, explanation: null };
  }
  const model = state?.deep_research_model;
  if (!model) {
    return {
      visible: true,
      enabled: false,
      explanation: DEEP_RESEARCH_UNKNOWN_MODEL_MESSAGE,
    };
  }
  if (state?.resident?.name === model) {
    return { visible: true, enabled: true, explanation: null };
  }
  return {
    visible: true,
    enabled: false,
    explanation: loadDeepResearchModelMessage(model),
  };
}
