/**
 * Behavioural tests for the pure view-model behind the Models screen
 * (src/app/models.tsx): turning a `StateResponse` from `GET /v1/state` into
 * the rows and resident label the screen renders.
 */

import { describe, it, expect } from "bun:test";
import { formatSize, toModelListView } from "./modelList";
import type { StateResponse } from "@shared/api";

describe("formatSize", () => {
  it("formats gigabyte-scale sizes with one decimal", () => {
    expect(formatSize(4_700_000_000)).toBe("4.7 GB");
  });

  it("formats megabyte-scale sizes as whole numbers", () => {
    expect(formatSize(42_000_000)).toBe("42 MB");
  });

  it("formats sub-megabyte sizes as whole kilobytes", () => {
    expect(formatSize(3_000)).toBe("3 KB");
  });
});

describe("toModelListView", () => {
  const baseState: StateResponse = {
    models: [],
    resident: null,
    operation: { kind: "idle" },
    generation: null,
  };

  it("mirrors an arbitrary models list verbatim, in order, with size labels", () => {
    const state: StateResponse = {
      ...baseState,
      models: [
        { name: "llama3:70b", size_bytes: 39_000_000_000 },
        { name: "phi3:mini", size_bytes: 2_300_000_000 },
      ],
    };

    const view = toModelListView(state);

    expect(view.rows).toEqual([
      {
        name: "llama3:70b",
        sizeLabel: "39.0 GB",
        isResident: false,
        canLoad: true,
      },
      {
        name: "phi3:mini",
        sizeLabel: "2.3 GB",
        isResident: false,
        canLoad: true,
      },
    ]);
  });

  it("marks only the row whose name matches the resident model", () => {
    const state: StateResponse = {
      ...baseState,
      models: [
        { name: "llama3:70b", size_bytes: 39_000_000_000 },
        { name: "phi3:mini", size_bytes: 2_300_000_000 },
      ],
      resident: { name: "phi3:mini", loaded_by_server: true },
    };

    const view = toModelListView(state);

    expect(view.rows.map((r) => r.isResident)).toEqual([false, true]);
    expect(view.residentLabel).toBe("Loaded: phi3:mini");
  });

  it("still reports the resident label when the resident model is not in the list (another tool loaded it)", () => {
    const state: StateResponse = {
      ...baseState,
      models: [{ name: "llama3:70b", size_bytes: 39_000_000_000 }],
      resident: { name: "mystery-model", loaded_by_server: false },
    };

    const view = toModelListView(state);

    expect(view.residentLabel).toBe("Loaded: mystery-model");
    expect(view.rows.every((r) => !r.isResident)).toBe(true);
  });

  it("reports 'Nothing loaded' and marks no row when resident is null", () => {
    const state: StateResponse = {
      ...baseState,
      models: [{ name: "llama3:70b", size_bytes: 39_000_000_000 }],
      resident: null,
    };

    const view = toModelListView(state);

    expect(view.residentLabel).toBe("Nothing loaded");
    expect(view.rows.every((r) => !r.isResident)).toBe(true);
  });

  it("produces no rows for an empty models list", () => {
    const view = toModelListView(baseState);

    expect(view.rows).toEqual([]);
    expect(view.residentLabel).toBe("Nothing loaded");
  });

  it("reports no busy label, no failure message, and no Unload availability when idle with nothing resident", () => {
    const view = toModelListView(baseState);

    expect(view.busyLabel).toBeNull();
    expect(view.failureMessage).toBeNull();
    expect(view.canUnload).toBe(false);
  });

  it("marks Load unavailable for the resident row, and Unload available, when idle with a resident model", () => {
    const state: StateResponse = {
      ...baseState,
      models: [
        { name: "llama3:70b", size_bytes: 39_000_000_000 },
        { name: "phi3:mini", size_bytes: 2_300_000_000 },
      ],
      resident: { name: "phi3:mini", loaded_by_server: true },
    };

    const view = toModelListView(state);

    expect(view.rows.map((r) => r.canLoad)).toEqual([true, false]);
    expect(view.canUnload).toBe(true);
    expect(view.busyLabel).toBeNull();
    expect(view.failureMessage).toBeNull();
  });

  it("shows a 'Loading <model>…' busy label and makes no row loadable or unloadable while loading", () => {
    const state: StateResponse = {
      ...baseState,
      models: [{ name: "llama3:70b", size_bytes: 39_000_000_000 }],
      operation: { kind: "loading", model: "llama3:70b" },
    };

    const view = toModelListView(state);

    expect(view.busyLabel).toBe("Loading llama3:70b…");
    expect(view.rows.every((r) => !r.canLoad)).toBe(true);
    expect(view.canUnload).toBe(false);
    expect(view.failureMessage).toBeNull();
  });

  it("shows an 'Unloading <model>…' busy label while unloading a named model", () => {
    const state: StateResponse = {
      ...baseState,
      resident: { name: "llama3:70b", loaded_by_server: true },
      operation: { kind: "unloading", model: "llama3:70b" },
    };

    const view = toModelListView(state);

    expect(view.busyLabel).toBe("Unloading llama3:70b…");
    expect(view.canUnload).toBe(false);
  });

  it("falls back to a nameless 'Unloading…' busy label when the operation carries no model", () => {
    const state: StateResponse = {
      ...baseState,
      resident: { name: "llama3:70b", loaded_by_server: true },
      operation: { kind: "unloading" },
    };

    const view = toModelListView(state);

    expect(view.busyLabel).toBe("Unloading…");
  });

  it("reports the failure reason from a load that ended idle with an error, and nothing resident", () => {
    const state: StateResponse = {
      ...baseState,
      models: [{ name: "llama3:70b", size_bytes: 39_000_000_000 }],
      resident: null,
      operation: {
        kind: "idle",
        model: "llama3:70b",
        error: "Insufficient memory to load llama3:70b",
      },
    };

    const view = toModelListView(state);

    expect(view.failureMessage).toBe("Insufficient memory to load llama3:70b");
    expect(view.residentLabel).toBe("Nothing loaded");
    expect(view.busyLabel).toBeNull();
    expect(view.rows[0].canLoad).toBe(true);
  });
});
