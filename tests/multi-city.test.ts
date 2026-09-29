import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Leaflet needs a real browser canvas; stub the map module (as app.smoke does).
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
import stations from "../data/stations.json";

const meta: DataMeta = { updatedAt: "", source: "sample", recordCount: 0, isSample: true };
const P = "PARIS (intramuros)";
const L = "LYON (intramuros)";
const M = "MARSEILLE ST CHARLES";

const train = (date: string, o: string, d: string, dep: string, arr: string, no: string): RawRecord => ({
  date,
  origine: o,
  destination: d,
  heure_depart: dep,
  heure_arrivee: arr,
  train_no: no,
  od_happy_card: "OUI",
  axe: "SUD EST",
});

// A small timetable where the order of trains decides whether a chain connects.
const records: RawRecord[] = [
  train("2026-06-25", P, L, "08:00", "10:00", "1"),
  train("2026-06-25", P, L, "14:00", "16:00", "2"),
  train("2026-06-26", P, L, "09:00", "11:00", "3"),
  train("2026-06-25", L, M, "09:00", "10:40", "4"),
  train("2026-06-25", L, M, "11:00", "12:40", "5"),
  train("2026-06-25", L, M, "17:00", "18:40", "6"),
  train("2026-06-25", L, P, "18:00", "20:00", "7"),
  train("2026-06-25", P, "LILLE", "07:00", "08:00", "8"),
  train("2026-06-25", P, "TOULON", "23:00", "00:50", "9"),
];

function setup(search: string): HTMLElement {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app") as HTMLElement;
  history.replaceState(null, "", `/${search}`);
  initApp(root, { trains: normalizeRecords(records), meta }, new StationRegistry(stations as Station[]));
  return root;
}

const legsLink = (...legs: string[]): string => `?mode=tour&legs=${encodeURIComponent(legs.join("~"))}`;
const legSections = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(".mc-result"));
const departures = (sec: HTMLElement): string[] =>
  Array.from(sec.querySelectorAll<HTMLElement>(".journey")).map((j) => j.textContent ?? "");
const legRows = (root: HTMLElement): HTMLInputElement[][] =>
  Array.from(root.querySelectorAll(".mc-leg")).map((r) => Array.from(r.querySelectorAll<HTMLInputElement>("input")));
const type = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-25T06:00:00Z"));
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute("open", "");
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("multi-city legs chain", () => {
  it("lists only the trains leaving after the previous leg arrives, and re-lists on a new pick", () => {
    const root = setup(legsLink(`${P}>${L}@2026-06-25`, `${L}>${M}@2026-06-25`));
    const [leg1, leg2] = legSections(root);
    // Leg 1 defaults to the 08:00 (arrives 10:00): the 09:00 out of Lyon is gone, with a note.
    expect(departures(leg2!).map((j) => j.includes("09:00"))).toEqual([false, false]);
    expect(leg2!.querySelector(".empty-hint")).not.toBeNull();
    // Taking the 14:00 instead leaves only the 17:00 for leg 2.
    const later = Array.from(leg1!.querySelectorAll<HTMLElement>(".journey")).find((j) => j.textContent?.includes("14:00"));
    later!.click();
    expect(departures(leg2!).length).toBe(1);
    expect(departures(leg2!)[0]).toContain("17:00");
  });

  it("flags a leg with no train after the previous arrival instead of marking it done", () => {
    const root = setup(legsLink(`${L}>${P}@2026-06-25`, `${P}>${L}@2026-06-25`));
    const leg2 = legSections(root)[1]!;
    expect(departures(leg2)).toEqual([]);
    expect(leg2.querySelector(".notice")).not.toBeNull();
    expect(leg2.querySelector(".mc-num")?.textContent).toBe("2");
    // The leg's calendar stays, to move it to another day.
    expect(leg2.querySelector(".cal-grid")).not.toBeNull();
  });

  it("flags a leg dated before the previous leg arrives, even on a day with no train", () => {
    for (const to of [M, "LILLE"]) {
      const root = setup(legsLink(`${P}>${L}@2026-06-26`, `${L}>${to}@2026-06-25`));
      expect(legSections(root)[1]!.querySelector(".notice")).not.toBeNull();
    }
  });

  it("offers the calendar on a leg with no train that day", () => {
    const root = setup(legsLink(`${L}>${M}@2026-06-26`));
    const leg = legSections(root)[0]!;
    expect(departures(leg)).toEqual([]);
    expect(leg.querySelector(".cal-grid")).not.toBeNull();
  });

  it("dates each leg in the trip modal", () => {
    const root = setup(legsLink(`${P}>${L}@2026-06-25`, `${L}>${M}@2026-06-25`));
    for (const sec of legSections(root)) sec.querySelector<HTMLElement>(".journey")!.click();
    const dialog = document.querySelector("dialog.trip-modal[open]");
    expect(dialog?.querySelectorAll(".trip-leg-date").length).toBe(2);
  });
});

describe("multi-city Surprise me", () => {
  it("fills the empty second row from the first leg's end, never re-rolling the first", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const root = setup("");
    (root.querySelector('[data-trip="multi"]') as HTMLElement).click();
    const surprise = root.querySelector<HTMLElement>(".surprise-btn")!;
    surprise.click();
    const [first] = legRows(root);
    const leg1 = [first![0]!.value, first![1]!.value];
    expect(leg1.every(Boolean)).toBe(true);
    surprise.click();
    const rows = legRows(root);
    expect([rows[0]![0]!.value, rows[0]![1]!.value]).toEqual(leg1);
    expect(rows[1]![0]!.value).toBe(leg1[1]);
    expect(rows[1]![1]!.value).not.toBe("");
  });

  it("picks a next hop leaving after the previous leg arrives", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const root = setup(legsLink(`${L}>${P}@2026-06-25`));
    root.querySelector<HTMLElement>(".surprise-btn")!.click();
    // Lyon → Paris lands at 20:00: the 07:00 to Lille has left, the 23:00 to Toulon has not.
    const [, next] = legRows(root);
    expect(next![1]!.value).toBe("Toulon");
    expect(next!.find((i) => i.type === "date")!.value).toBe("2026-06-25");
  });
});

describe("multi-city input", () => {
  it("stops Search on a leg naming no station and says so", () => {
    const root = setup("");
    (root.querySelector('[data-trip="multi"]') as HTMLElement).click();
    const [leg1, leg2] = legRows(root);
    type(leg1![0]!, "Paris");
    type(leg1![1]!, "Lyon");
    type(leg2![1]!, "Zzzville");
    root.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(new URLSearchParams(location.search).get("legs")).toBeNull();
    expect(root.querySelector(".surprise-msg")?.textContent).not.toBe("");
    expect(leg2![1]!.classList.contains("is-invalid")).toBe(true);
  });

  it("keeps an unknown tour city in the field, flagged", () => {
    const root = setup("");
    (root.querySelector('[data-trip="multi"]') as HTMLElement).click();
    root.querySelectorAll<HTMLElement>(".multi-switch .multi-tab")[1]!.click();
    const cities = root.querySelector<HTMLInputElement>(".cities-input input")!;
    cities.value = "Qwerty";
    cities.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(cities.value).toBe("Qwerty");
    expect(cities.classList.contains("is-invalid")).toBe(true);
    expect(root.querySelector(".surprise-msg")?.textContent).not.toBe("");
  });

  it("names the route on each leg header and the city on each chip remover", () => {
    const root = setup(legsLink(`${P}>${L}@2026-06-25`));
    const head = root.querySelector<HTMLElement>(".mc-result-head")!;
    expect(head.getAttribute("aria-label")).toBeNull();
    expect(head.textContent).toContain("Lyon");
    for (const input of legRows(root)[0]!.filter((i) => i.type === "text")) {
      expect(input.getAttribute("aria-label")).toBeTruthy();
    }
    root.querySelectorAll<HTMLElement>(".multi-switch .multi-tab")[1]!.click();
    const cities = root.querySelector<HTMLInputElement>(".cities-input input")!;
    cities.value = "Lyon";
    cities.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const remove = root.querySelector(".city-chip .chip-x")?.getAttribute("aria-label") ?? "";
    expect(remove).toContain("Lyon");
    expect(remove).not.toMatch(/favo/i);
  });
});

describe("saved tour modal", () => {
  it("shows no map action behind the dialog", () => {
    const root = setup(`?mode=tour&from=${encodeURIComponent(P)}&cities=${encodeURIComponent(L)}&date=2026-06-25&dmin=1&dmax=3`);
    root.querySelector<HTMLElement>(".results .tour-save")!.click();
    root.querySelector<HTMLElement>(".trip-open")!.click();
    const dialog = document.querySelector("dialog.trip-modal[open]")!;
    expect(dialog.querySelector(".tour")).not.toBeNull();
    expect(dialog.querySelector(".btn-map")).toBeNull();
    expect(dialog.querySelector("button.tour-head")).toBeNull();
  });
});
