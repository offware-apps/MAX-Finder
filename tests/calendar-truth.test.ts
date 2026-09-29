import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Leaflet needs a real browser canvas; stub the map module so the UI runs under jsdom.
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
import { findJourneys } from "../src/core/connections";
import { bestGetawayTo, getawayIdeas, reverseGetawayIdeas, stayCalendar } from "../src/core/getaways";
import { reachableGroups, windowStats } from "../src/core/destinations";
import { formatDuration } from "../src/util/time";
import stations from "../data/stations.json";

const P = "PARIS (intramuros)";
const L = "LYON (intramuros)";
const row = (date: string, from: string, to: string, dep: string, arr: string, no: string): RawRecord => ({
  date,
  origine: from,
  destination: to,
  heure_depart: dep,
  heure_arrivee: arr,
  train_no: no,
  od_happy_card: "OUI",
});

describe("a green day and a number tell the truth (core)", () => {
  it("a fixed N-night stay is green only when a return N nights later exists", () => {
    // The only way back is one night later: a 1-night stay works, a 2-night stay does not.
    const trains = normalizeRecords([
      row("2026-07-01", P, "ROUEN", "09:00", "10:00", "X1"),
      row("2026-07-02", "ROUEN", P, "18:00", "19:00", "X2"),
    ]);
    const two = stayCalendar(trains, P, "ROUEN", ["2026-07-01"], { maxConnections: 0, nights: 2 }, "nights");
    expect(two[0]!.available).toBe(false);
    const one = stayCalendar(trains, P, "ROUEN", ["2026-07-01"], { maxConnections: 0, nights: 1 }, "nights");
    expect(one[0]).toMatchObject({ available: true, count: 1 });
    // Flexible still keeps the longest feasible stay up to the ceiling.
    const flex = stayCalendar(trains, P, "ROUEN", ["2026-07-01"], { maxConnections: 0, nights: 2, flexibleNights: true }, "nights");
    expect(flex[0]).toMatchObject({ available: true, count: 1 });
  });

  it("counts whole hours on site rounded down, never more than the trip gives", () => {
    const trains = normalizeRecords([
      row("2026-07-01", P, "ARRAS", "09:00", "10:00", "A1"),
      row("2026-07-01", "ARRAS", P, "20:54", "21:54", "A2"),
    ]);
    const cal = stayCalendar(trains, P, "ARRAS", ["2026-07-01"], { maxConnections: 0 }, "hours");
    expect(cal[0]!.count).toBe(10); // 10:00 → 20:54 is 10 h 54
  });

  it("reverse same-day discovery pairs the earliest arrival with the latest return, as forward does", () => {
    // Two ways into ARRAS: a slow one landing at 10:00 and a fast one landing at 12:00. Two
    // ways home: 14:00 and 21:00, plus one landing after midnight.
    const trains = normalizeRecords([
      row("2026-07-01", P, "ARRAS", "07:00", "10:00", "S1"),
      row("2026-07-01", P, "ARRAS", "11:00", "12:00", "F1"),
      row("2026-07-01", "ARRAS", P, "14:00", "15:00", "R1"),
      row("2026-07-01", "ARRAS", P, "21:00", "22:00", "R2"),
      row("2026-07-01", "ARRAS", P, "23:30", "00:30", "R3"),
    ]);
    const opts = { maxConnections: 0 };
    const forward = bestGetawayTo(trains, P, "ARRAS", "2026-07-01", opts)!;
    expect(forward.onSiteMin).toBe(11 * 60);
    const reverse = reverseGetawayIdeas(trains, "ARRAS", ["2026-07-01"], opts);
    const paris = reverse.trips.find((g) => g.destination === P);
    expect(paris?.onSiteMin).toBe(forward.onSiteMin);
    expect(paris?.outbound.legs[0]!.trainNo).toBe("S1");
    expect(paris?.back.legs[0]!.trainNo).toBe("R2"); // not R3: that one gets home after midnight
    expect(reverse.perDay[0]!.count).toBe(1);
  });

  it("keeps the shorter ride when two outbounds land at the same time", () => {
    const trains = normalizeRecords([
      row("2026-07-01", P, "ARRAS", "06:00", "10:00", "SLOW"),
      row("2026-07-01", P, "ARRAS", "09:00", "10:00", "FAST"),
      row("2026-07-01", "ARRAS", P, "21:00", "22:00", "R"),
    ]);
    const g = bestGetawayTo(trains, P, "ARRAS", "2026-07-01", { maxConnections: 0 })!;
    expect(g.outbound.legs[0]!.trainNo).toBe("FAST");
    expect(g.travelMin).toBe(120);
    expect(getawayIdeas(trains, P, ["2026-07-01"], { maxConnections: 0 }).trips[0]!.travelMin).toBe(g.travelMin);
  });

  it("lists a train seen at two stations of one group once, on its shortest row", () => {
    // Train 6627 reaches LYON (intramuros) twice (Part-Dieu 19:54, Perrache 20:10); train
    // 5380 leaves it twice (Perrache 06:12, Part-Dieu 06:30). The later row comes first.
    const trains = normalizeRecords([
      row("2026-09-30", P, L, "17:52", "20:10", "6627"),
      row("2026-09-30", P, L, "17:52", "19:54", "6627"),
      row("2026-09-30", L, "MASSY TGV", "06:12", "08:34", "5380"),
      row("2026-09-30", L, "MASSY TGV", "06:30", "08:34", "5380"),
    ]);
    const toLyon = findJourneys(trains, P, L, "2026-09-30", { maxConnections: 0 });
    expect(toLyon.map((j) => j.legs[0]!.arrive)).toEqual(["19:54"]);
    const toMassy = findJourneys(trains, L, "MASSY TGV", "2026-09-30", { maxConnections: 0 });
    expect(toMassy.map((j) => j.legs[0]!.depart)).toEqual(["06:30"]);
  });

  it("counts and times browse cards over the given days only", () => {
    const trains = normalizeRecords([
      row("2026-06-24", P, L, "08:00", "09:50", "OLD"), // yesterday: not bookable
      row("2026-06-25", P, L, "08:00", "10:14", "A"),
      row("2026-06-26", P, L, "08:00", "10:05", "B"),
    ]);
    const window = ["2026-06-25", "2026-06-26"];
    expect(windowStats(trains, P, "from", window).get(L)).toEqual({ trains: 2, days: 2 });
    const day = reachableGroups(trains, P, "from", ["2026-06-25"]);
    expect(day.map((g) => [g.station, g.count, g.minDurationMin])).toEqual([[L, 1, 134]]);
  });
});

// --- the app ------------------------------------------------------------------

const meta: DataMeta = { updatedAt: "", source: "sample", recordCount: 0, isSample: true };

// Paris ⇄ Lyon every day from 06-25 to 06-30; the way back leaves at 19:26 and 21:00, the
// 21:00 one only from 06-27. A same-day trip on 06-25 leaves 10 h 26 on site.
const days = ["2026-06-25", "2026-06-26", "2026-06-27", "2026-06-28", "2026-06-29", "2026-06-30"];
const fixture: RawRecord[] = days.flatMap((d, i) => [
  row(d, P, L, "07:00", "09:00", `O${i}`),
  row(d, L, P, "19:26", "21:26", `R${i}`),
  ...(d >= "2026-06-27" ? [row(d, L, P, "21:00", "23:00", `N${i}`)] : []),
]);

function setup(search: string, records: RawRecord[] = fixture): HTMLElement {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app") as HTMLElement;
  history.replaceState(null, "", `/${search}`);
  initApp(root, { trains: normalizeRecords(records), meta }, new StationRegistry(stations as Station[]));
  return root;
}

const route = `mode=od&from=${encodeURIComponent(P)}&to=${encodeURIComponent(L)}`;
const formCell = (root: HTMLElement, date: string): HTMLElement =>
  root.querySelector<HTMLElement>(`.form-cal-mount .cal-cell[data-date="${date}"]`)!;
const formSelected = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>(".form-cal-mount .cal-cell.sel")).map((c) => c.dataset.date!);
const picked = (root: HTMLElement): string => root.querySelector(".form-cal-picked")!.textContent ?? "";
const title = (root: HTMLElement): string => root.querySelector("#results-title")!.textContent ?? "";
const param = (k: string): string | null => new URLSearchParams(location.search).get(k);

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

describe("a green day and a number tell the truth (app)", () => {
  it("moves the form calendar when a day is picked under the results", () => {
    const root = setup(`?${route}&date=2026-06-25`);
    expect(formSelected(root)).toEqual(["2026-06-25"]);
    root.querySelector<HTMLElement>('.results .cal-cell[data-date="2026-06-27"]')!.click();
    expect(param("date")).toBe("2026-06-27");
    expect(formSelected(root)).toEqual(["2026-06-27"]);
    expect(picked(root)).toContain(title(root).split("—").pop()!.trim());
  });

  it("moves the Flexible range and stepper when the return is picked under the results", () => {
    const root = setup(`?${route}&date=2026-06-25&stay=flex&rdate=2026-06-27`);
    expect(formSelected(root)).toEqual(["2026-06-25", "2026-06-27"]);
    root.querySelector<HTMLElement>('.od-return-cal .cal-cell[data-date="2026-06-29"]')!.click();
    expect(formSelected(root)).toEqual(["2026-06-25", "2026-06-29"]);
    expect(picked(root).endsWith(title(root).split("→").pop()!.trim())).toBe(true);
    expect(root.querySelector(".nights-val")!.textContent).toBe("4 nights");
  });

  it("Flexible: header, date pill, URL and results agree before and after each range tap", () => {
    // No return in the link: the results propose departure + 2, so the header does too.
    const root = setup(`?${route}&date=2026-06-25&stay=flex`);
    const ret = (): string => title(root).split("→").pop()!.trim();
    expect(picked(root).endsWith(ret())).toBe(true);
    expect(formSelected(root)).toEqual(["2026-06-25", "2026-06-27"]);
    expect(root.querySelector(".nights-val")!.textContent).toBe("2 nights");

    // First tap: the departure, pending on the form; the URL and the results keep their range.
    const shown = title(root);
    formCell(root, "2026-06-26").click();
    expect(param("date")).toBe("2026-06-25");
    expect(title(root)).toBe(shown);
    expect(picked(root)).toBe("Departure: Fri, Jun 26 — pick the return");
    expect(formSelected(root)).toEqual(["2026-06-26"]);
    // While the return is awaited, a day before the departure is not a return day.
    expect(formCell(root, "2026-06-25").classList.contains("ok")).toBe(false);
    expect(formCell(root, "2026-06-27").classList.contains("ok")).toBe(true);

    // Second tap: the return, run with the departure.
    formCell(root, "2026-06-29").click();
    expect(param("date")).toBe("2026-06-26");
    expect(param("rdate")).toBe("2026-06-29");
    expect(title(root)).not.toBe(shown);
    expect(picked(root).endsWith(ret())).toBe(true);
    expect(formSelected(root)).toEqual(["2026-06-26", "2026-06-29"]);
    expect(root.querySelector(".nights-val")!.textContent).toBe("3 nights");
  });

  it("toggling Flexible keeps the same-day minimum in place, inert", () => {
    const root = setup(`?${route}&date=2026-06-25&stay=day`);
    const field = Array.from(root.querySelectorAll<HTMLElement>(".search-form .field")).find((f) =>
      (f.textContent ?? "").includes("Minimum time there"),
    )!;
    const select = field.querySelector("select") as HTMLSelectElement;
    expect(field.style.display).not.toBe("none");
    expect(select.disabled).toBe(false);
    root.querySelector<HTMLElement>(".nights-flex")!.click();
    expect(field.style.display).not.toBe("none");
    expect(select.disabled).toBe(true);
  });

  it("a stay from the last bookable day reads its real return, not the same day", () => {
    const root = setup(`?${route}&date=2026-07-24&stay=1`);
    const chips = Array.from(root.querySelectorAll(".results .mc-date")).map((e) => e.textContent);
    expect(chips[0]).not.toBe(chips[1]);
    expect(root.querySelector(".nights-val")!.textContent).toBe("1 night");
    expect(root.querySelector(".return-list .empty")).not.toBeNull();
  });

  it("a stay's discovery card counts the return its trip picks by default, the fastest", () => {
    // The sweep's latest return home by midnight (21:00, 2 h 30) is not the fastest (19:26, 2 h).
    const records = [
      row("2026-06-27", P, L, "07:00", "09:00", "OUT"),
      row("2026-06-28", L, P, "19:26", "21:26", "FAST"),
      row("2026-06-28", L, P, "21:00", "23:30", "LATE"),
    ];
    const root = setup(`?mode=from&from=${encodeURIComponent(P)}&date=2026-06-27&stay=1`, records);
    const card = root.querySelector<HTMLElement>(`.results .group-card[data-station="${L}"]`)!;
    const total = new RegExp(`${formatDuration(240)}(?!\\d)`); // 4 h, not 4 h 30
    expect(card.querySelector(".dest-meta bdi")!.textContent).toBe(formatDuration(240));
    card.querySelector<HTMLElement>(".dest-main")!.click();
    expect(root.querySelector(".return-list .journey")?.textContent).toContain("19:26");
    expect(root.querySelector(".rt-total")!.textContent).toMatch(total);
  });

  it("a discovery card shows the exact time on site of the trip it opens", () => {
    const root = setup(`?mode=from&from=${encodeURIComponent(P)}&date=2026-06-25&stay=day`);
    const card = root.querySelector<HTMLElement>(`.results .group-card[data-station="${L}"]`)!;
    expect(card.textContent).toContain(formatDuration(626)); // 09:00 → 19:26
    card.querySelector<HTMLElement>(".dest-main")!.click();
    expect(root.querySelector(".rt-total")!.textContent).toContain(formatDuration(626));
  });

  it("a browse card's time is the chosen day's fastest train, not the month's", () => {
    const records = [
      row("2026-06-25", P, L, "07:00", "09:14", "SLOW"),
      row("2026-06-26", P, L, "07:00", "09:05", "FAST"),
    ];
    const root = setup(`?mode=from&from=${encodeURIComponent(P)}&date=2026-06-25`, records);
    const card = root.querySelector<HTMLElement>(`.results .group-card[data-station="${L}"]`)!;
    expect(card.querySelector(".dest-meta")!.textContent).toContain(formatDuration(134));
  });

  it("counts a destination's trains from today on", () => {
    const records = [
      row("2026-06-24", P, L, "07:00", "09:00", "PAST"),
      row("2026-06-25", P, L, "07:00", "09:00", "A"),
      row("2026-06-26", P, L, "07:00", "09:00", "B"),
    ];
    const root = setup(`?mode=best&from=${encodeURIComponent(P)}`, records);
    const card = root.querySelector<HTMLElement>(`.results .group-card[data-station="${L}"]`)!;
    expect(card.querySelector(".stat-chip")!.textContent).toMatch(/^2 train/);
  });
});
