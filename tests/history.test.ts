import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Leaflet needs a real browser canvas; stub the map module (as the smoke suite does).
vi.mock("../src/ui/map", () => ({
  RouteMap: class {
    onSelect: ((id: string) => void) | null = null;
    show(): void {}
    route(): void {}
    radius(): void {}
    base(): void {}
    highlight(): void {}
    invalidate(): void {}
    focus(): void {}
    setInfo(): void {}
  },
}));

import type { RawRecord, Station, DataMeta } from "../src/types";
import { normalizeRecords } from "../src/data/dataset";
import { StationRegistry } from "../src/data/stations";
import { initApp } from "../src/app";
import * as store from "../src/state/store";
import sample from "../data/tgvmax.sample.json";
import stations from "../data/stations.json";

const P = "PARIS (intramuros)";
const L = "LYON (intramuros)";
const enc = encodeURIComponent;
const meta: DataMeta = { updatedAt: "", source: "sample", recordCount: 0, isSample: true };

/** Mount the app on `search`; `seed` runs on the cleared storage before it loads. */
function setup(search: string, seed?: () => void): HTMLElement {
  localStorage.clear();
  seed?.();
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app") as HTMLElement;
  history.replaceState(null, "", `/${search}`);
  initApp(root, { trains: normalizeRecords(sample as RawRecord[]), meta }, new StationRegistry(stations as Station[]));
  return root;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-25T12:00:00Z"));
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe("history and navigation", () => {
  it("opens a favorite from a tour page with a clean Trip query (no cities= left over)", () => {
    const root = setup(`?mode=tour&from=${enc(P)}&cities=${enc(L)}&date=2026-06-25`, () =>
      store.toggleFavorite({ origin: P, destination: L }),
    );
    root.querySelector<HTMLButtonElement>(".fav-row:not(.trip-row) .fav-open")!.click();
    const params = new URLSearchParams(location.search);
    expect(params.get("mode")).toBe("od");
    expect(params.get("to")).toBe(L);
    expect(params.has("cities")).toBe(false);
  });

  it("an empty Search adds no history entry and says what is missing", () => {
    const root = setup(`?mode=od&from=${enc(P)}&to=${enc(L)}&date=2026-06-25`);
    const [origin, destination] = root.querySelectorAll<HTMLInputElement>(".search-form .od-fields input");
    for (const input of [origin!, destination!]) {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const before = { length: history.length, search: location.search };
    root.querySelector<HTMLButtonElement>(".search-form .form-actions button.btn-primary")!.click();
    expect(history.length).toBe(before.length);
    expect(location.search).toBe(before.search);
    expect(root.querySelector(".surprise-msg")?.textContent).not.toBe("");
  });
});
