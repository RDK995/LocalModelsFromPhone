/**
 * Pure view-model for the Models screen (src/app/models.tsx): turning a
 * `StateResponse` from `GET /v1/state` into the rows and resident label the
 * screen renders. Extracted out of `src/app/models.tsx` (a `.tsx` module,
 * which cannot be imported by a bun test) so it can be tested directly, the
 * same way `streamReducer.ts` is extracted out of `chat.tsx`.
 */

import type { StateResponse } from "@shared/api";

export interface ModelRow {
  name: string;
  sizeLabel: string;
  isResident: boolean;
}

export interface ModelListView {
  rows: ModelRow[];
  residentLabel: string;
}

/**
 * Format a byte count using decimal units, the way installed-model sizes are
 * naturally read: gigabytes to one decimal place once the file is that big,
 * whole megabytes below that, and whole kilobytes below that.
 */
export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `${Math.round(bytes / 1_000_000)} MB`;
  }
  return `${Math.round(bytes / 1_000)} KB`;
}

/**
 * Build the rows and resident label the Models screen renders from a raw
 * `GET /v1/state` response. `resident` can name a model that is not in
 * `models` at all -- another tool on the Mac can load a model the phone
 * never listed -- so `residentLabel` is derived from `resident` alone, and
 * `isResident` is a per-row match against it, not a lookup into it.
 */
export function toModelListView(state: StateResponse): ModelListView {
  const residentName = state.resident?.name ?? null;

  const rows: ModelRow[] = state.models.map((model) => ({
    name: model.name,
    sizeLabel: formatSize(model.size_bytes),
    isResident: model.name === residentName,
  }));

  const residentLabel =
    state.resident !== null ? `Loaded: ${state.resident.name}` : "Nothing loaded";

  return { rows, residentLabel };
}
