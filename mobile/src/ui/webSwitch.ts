/**
 * Pure view-model for the web search switch state (M10-FR18).
 * Determines whether the switch is enabled and provides an explanation
 * when it's disabled (e.g., resident model lacks tools support).
 */

import type { Model, ResidentModel } from "@shared/api";

export interface WebSwitchState {
  enabled: boolean;
  explanation: string | null;
}

/**
 * Returns the enabled state and explanation text for the web search switch.
 * The switch is enabled only when:
 * - A model is resident (loaded)
 * - That model is found in the models list
 * - That model has tools: true
 *
 * Otherwise, returns disabled with a brief explanation of why (FR18).
 */
export function webSwitchState(
  models: Model[] | null | undefined,
  resident: ResidentModel | null | undefined
): WebSwitchState {
  if (!resident) {
    return {
      enabled: false,
      explanation: "Load a model to use web search.",
    };
  }

  if (!models) {
    return {
      enabled: false,
      explanation: `Can't tell whether ${resident.name} supports web search.`,
    };
  }

  const model = models.find((m) => m.name === resident.name);

  if (!model) {
    return {
      enabled: false,
      explanation: `Can't tell whether ${resident.name} supports web search.`,
    };
  }

  if (!model.tools) {
    return {
      enabled: false,
      explanation: `${resident.name} can't use web search (it has no tools support).`,
    };
  }

  return {
    enabled: true,
    explanation: null,
  };
}

/**
 * The value the switch displays. The stored preference is kept as is; the
 * switch just shows off while web search is unavailable (FR18).
 */
export function webSwitchDisplayValue(
  stored: boolean | undefined,
  state: WebSwitchState | null | undefined
): boolean {
  return stored === true && state?.enabled === true;
}
