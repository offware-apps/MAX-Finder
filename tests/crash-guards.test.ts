import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Leaflet needs a real browser canvas; stub the map module so the rest of the
// UI can be exercised under jsdom.
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
import { queryFromParams, loadFavorites, loadWatched, loadTrips } from "../src/state/store";
import { en } from "../src/i18n/en";
import sample from "../data/tgvmax.sample.json";
import stations from "../data/stations.json";

const meta: DataMeta = { updatedAt: "", source: "sample", recordCount: 0, isSample: true };
const P = encodeURIComponent("PARIS (intramuros)");
const L = encodeURIComponent("LYON (intramuros)");

function setup(search: string, rows = sample as RawRecord[]): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app") as HTMLElement;
  history.replaceState(null, "", `/${search}`);
  initApp(root, { trains: normalizeRecords(rows), meta }, new StationRegistry(stations as Station[]));
  return root;
}

const journey = {
  date: "2026-06-25",
  origin: "PARIS (intramuros)",
  destination: "LYON (intramuros)",
  legs: [{ date: "2026-06-25", origin: "PARIS (intramuros)", destination: "LYON (intramuros)", trainNo: "6601" }],
  departMin: 480,
  arriveMin: 600,
  totalDurationMin: 120,
  layovers: [],
  hubs: [],
};

beforeEach(() => {
  localStorage.clear();
  // Pin "today" to the sample-data epoch so its dates sit inside the bookable window.
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

describe("a malformed date or time in a link (H1)", () => {
  it("drops dates that are not real YYYY-MM-DD calendar days, and unparseable times", () => {
    for (const bad of ["2026-10-1", "2026-10-00", "2026-02-30", "garbage"]) {
      const q = queryFromParams(new URLSearchParams({ date: bad, rdate: bad, by: bad }), "2026-06-25");
      expect(q.date).toBe("2026-06-25");
      expect(q.returnDate).toBeUndefined();
      expect(q.tourEndDate).toBeUndefined();
    }
    const q = queryFromParams(new URLSearchParams({ after: "garbage", before: "25:99", arrbefore: "8:00" }), "2026-06-25");
    expect([q.departAfter, q.departBefore, q.arriveBefore]).toEqual([undefined, undefined, undefined]);
    expect(queryFromParams(new URLSearchParams({ after: "08:30" }), "2026-06-25").departAfter).toBe("08:30");
  });

  it("opens the trip on today instead of throwing, and puts today in the address bar", () => {
    // Both sort inside the bookable window as strings, so only the date check catches them.
    for (const bad of ["2026-06-3", "2026-07-00"]) {
      const root = setup(`?mode=od&from=${P}&to=${L}&date=${bad}&rdate=${bad}&lang=en`);
      expect(root.querySelector(".mode-tab.active")).not.toBeNull();
      const url = new URLSearchParams(location.search);
      expect(url.get("date")).toBe("2026-06-25");
      expect(url.has("rdate")).toBe(false);
      expect(url.get("lang")).toBe("en");
    }
  });

  it("rewrites an out-of-window date in place, without a new history entry", () => {
    const before = history.length;
    setup(`?mode=od&from=${P}&to=${L}&date=2020-01-01`);
    expect(new URLSearchParams(location.search).get("date")).toBe("2026-06-25");
    expect(history.length).toBe(before);
  });

  it("ignores an unparseable time filter rather than hiding every train", () => {
    const root = setup(`?mode=od&from=${P}&to=${L}&date=2026-06-25&after=garbage&lang=en`);
    expect(root.textContent).not.toContain(en.res_none);
    expect(new URLSearchParams(location.search).has("after")).toBe(false);
  });
});

describe("a malformed entry in a stored list (H2)", () => {
  it("drops the bad entries and keeps the good ones", () => {
    const fav = { origin: "PARIS (intramuros)", destination: "LYON (intramuros)" };
    localStorage.setItem("mj.favorites", JSON.stringify([null, {}, 1, fav]));
    localStorage.setItem("mj.watched", JSON.stringify([null, fav]));
    const trip = { id: "x", kind: "one-way", outbound: journey, savedAt: 1 };
    localStorage.setItem(
      "mj.trips",
      JSON.stringify([
        null,
        {},
        { ...trip, outbound: { ...journey, legs: undefined } },
        { ...trip, outbound: { ...journey, date: "2026-10-1" } },
        { ...trip, kind: "tour", tour: {} },
        { ...trip, inbound: { ...journey, hubs: undefined } },
        trip,
      ]),
    );
    expect(loadFavorites()).toEqual([fav]);
    expect(loadWatched()).toEqual([fav]);
    expect(loadTrips()).toEqual([trip]);
  });

  it("still opens the app", () => {
    localStorage.setItem("mj.favorites", "[null]");
    localStorage.setItem("mj.watched", "[{}]");
    localStorage.setItem("mj.trips", '[{"id":"t","kind":"tour","outbound":{},"tour":{}}]');
    const root = setup(`?mode=from&from=${P}&date=2026-06-25`);
    expect(root.querySelectorAll(".group-card").length).toBeGreaterThan(0);
  });
});

describe("station names in a link (L3)", () => {
  it("resolves case- and accent-insensitive names to the id the data uses", () => {
    const registry = new StationRegistry(stations as Station[]);
    registry.addMissing(["PARIS (intramuros)", "LILLE (intramuros)", "MARSEILLE ST CHARLES"]);
    expect(registry.resolve("paris")).toBe("PARIS (intramuros)");
    expect(registry.resolve("LILLE")).toBe("LILLE (intramuros)");
    expect(registry.resolve("marseille saint-charles")).toBe("MARSEILLE ST CHARLES");
    expect(registry.resolve("FOOBAR")).toBeUndefined();
  });

  it("shows the trains of a lower-case link and writes the ids back", () => {
    const root = setup("?mode=od&from=paris&to=lyon&date=2026-06-25&lang=en");
    expect(root.textContent).not.toContain(en.res_none);
    const url = new URLSearchParams(location.search);
    expect([url.get("from"), url.get("to")]).toEqual(["PARIS (intramuros)", "LYON (intramuros)"]);
  });

  it("picks the station with trains when the registry also has a bare id", () => {
    const rows = (sample as RawRecord[]).map((r) =>
      r.destination === "LILLE" ? { ...r, destination: "LILLE (intramuros)" } : r,
    );
    const root = setup(`?mode=od&from=${P}&to=LILLE&date=2026-06-25&lang=en`, rows);
    expect(root.textContent).not.toContain(en.res_none);
    expect(new URLSearchParams(location.search).get("to")).toBe("LILLE (intramuros)");
  });

  it("says a name matching no station is unknown", () => {
    const root = setup(`?mode=od&from=${P}&to=FOOBAR&date=2026-06-25&lang=en`);
    expect(root.textContent).toContain(en.err_station.replace("{station}", "FOOBAR"));
    expect(root.textContent).not.toContain(en.res_none);
  });
});

describe("the boot error card", () => {
  it("does not blame the data when the page itself fails to open", async () => {
    vi.resetModules();
    vi.doMock("../src/data/dataset", () => ({ loadDataset: () => Promise.resolve({ trains: [], meta }) }));
    vi.doMock("../src/app", () => ({
      initApp: () => {
        throw new Error("boom");
      },
    }));
    vi.doMock("../src/pwa/register", () => ({ registerServiceWorker: () => {} }));
    vi.doMock("../src/native/capacitor", () => ({ initNative: () => Promise.resolve() }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = '<div id="app"></div>';
    Object.defineProperty(navigator, "language", { value: "en-US", configurable: true });
    await import("../src/main");
    await vi.waitFor(() => expect(document.querySelector(".error-title")).not.toBeNull());
    expect(document.querySelector(".error-title")?.textContent).toBe(en.err_app);
  });
});
