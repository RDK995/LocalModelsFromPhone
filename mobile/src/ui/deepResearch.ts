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

/** "m:ss of m:ss" for the run clock against its budget (seconds floor). */
export function researchClockLabel(elapsedMs: number, budgetMs: number): string {
  const mmss = (ms: number): string => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };
  return `${mmss(elapsedMs)} of ${mmss(budgetMs)}`;
}

/** Label for a finished deep research run's status. */
export function researchStatusLabel(
  status: "complete" | "partial" | "failed"
): string {
  return `Deep research: ${status}`;
}

export interface ResearchClockAnchor {
  elapsed_ms: number;
  budget_ms: number;
  /** Local time (ms) at which the server's elapsed_ms was received. */
  anchored_at: number;
}

/** Elapsed time projected locally from the last server value, capped at the budget. */
export function liveResearchElapsedMs(clock: ResearchClockAnchor, now: number): number {
  return Math.min(clock.budget_ms, clock.elapsed_ms + Math.max(0, now - clock.anchored_at));
}

export interface IntervalTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Calls `onTick` every 1000 ms; returns a function that stops the ticker. */
export function startSecondTicker(
  onTick: () => void,
  timers: IntervalTimers = { setInterval, clearInterval }
): () => void {
  const handle = timers.setInterval(onTick, 1000);
  return () => timers.clearInterval(handle);
}
