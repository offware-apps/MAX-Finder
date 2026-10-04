import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

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
import { t, getLang } from "../src/i18n";
import { formatDuration } from "../src/util/time";
import stations from "../data/stations.json";

const meta: DataMeta = { updatedAt: "", source: "sample", recordCount: 0, isSample: true };
const P = "PARIS (intramuros)";
const enc = encodeURIComponent;

/** One free-MAX train. */
function tr(date: string, from: string, to: string, dep: string, arr: string, no: string): RawRecord {
  return {
    date,
    origine: from,
    destination: to,
    heure_depart: dep,
    heure_arrivee: arr,
    train_no: no,
    od_happy_card: "OUI",
    axe: "",
  } as RawRecord;
}

// rAF callbacks wait here until flush(), as in a browser, so chunked lists render in batches.
let frames: FrameRequestCallback[] = [];
function flush(): void {
  while (frames.length) frames.shift()!(0);
}

function setup(search: string, records: RawRecord[], saved?: object): HTMLElement {
  localStorage.clear();
  if (saved) localStorage.setItem("mj.settings", JSON.stringify(saved));
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app") as HTMLElement;
  history.replaceState(null, "", `/${search}`);
  initApp(root, { trains: normalizeRecords(records), meta }, new StationRegistry(stations as Station[]));
  flush();
  return root;
}

const cardSelect = (root: HTMLElement): HTMLSelectElement =>
  root.querySelector<HTMLOptionElement>('select option[value="senior"]')!.parentElement as HTMLSelectElement;
const originInput = (root: HTMLElement): HTMLInputElement =>
  root.querySelectorAll<HTMLInputElement>('.od-fields input[list="station-list"]')[0]!;
const destinationInput = (root: HTMLElement): HTMLInputElement =>
  root.querySelectorAll<HTMLInputElement>('.od-fields input[list="station-list"]')[1]!;
function search(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>(".search-form .form-actions button.btn-primary")!.click();
  flush();
}
/** A day as the app writes it. */
const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat(getLang(), { weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${iso}T00:00:00`),
  );
const button = (root: HTMLElement, text: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>(".results button")].find((b) => b.textContent === text);

beforeEach(() => {
  // 2026-06-25 is a Thursday: the 27th is a Saturday.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-25T12:00:00Z"));
  frames = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("generated pages", () => {
  it("take the site and repository URLs from src/config.ts", () => {
    const src = readFileSync("scripts/generate-pages.mjs", "utf8");
    expect(src).toContain('from "../src/config.ts"');
    expect(src).not.toMatch(/https:\/\/[\w-]+\.github\.(io|com)/);
  });
});

describe("the card", () => {
  const lyon = [
    tr("2026-06-26", P, "LYON (intramuros)", "08:00", "10:00", "1"),
    tr("2026-06-27", P, "LYON (intramuros)", "08:00", "10:00", "2"),
  ];
  const od = `?mode=od&from=${enc(P)}&to=${enc("LYON (intramuros)")}&date=2026-06-26`;

  it("a link without card= keeps the saved MAX SENIOR, and the address bar adds none", () => {
    const root = setup(od.replace(enc(P), "paris"), lyon, { card: "senior" });
    expect(cardSelect(root).value).toBe("senior");
    const params = new URLSearchParams(location.search);
    expect(params.get("from")).toBe(P); // the write-back ran
    expect(params.has("card")).toBe(false);
  });
});

describe("a typed station", () => {
  const trains = [
    tr("2026-06-25", P, "LYON (intramuros)", "08:00", "10:00", "1"),
    tr("2026-06-25", "TOURS", P, "08:00", "10:00", "2"),
    tr("2026-06-25", "ST PIERRE DES CORPS", P, "08:00", "10:00", "3"),
  ];

  it("that matches several stations stops Search in red with a message", () => {
    const root = setup("", trains);
    originInput(root).value = "mont";
    search(root);
    expect(location.search).not.toContain("from=");
    expect(originInput(root).classList.contains("is-invalid")).toBe(true);
    expect(root.querySelector(".surprise-msg")!.textContent).toBe(t("err_station", { station: "mont" }));
  });

  it("an unknown destination does not turn into a browse from the origin", () => {
    const root = setup("", trains);
    originInput(root).value = "Paris";
    destinationInput(root).value = "Lyonzz";
    search(root);
    expect(location.search).not.toContain("mode=from");
    expect(destinationInput(root).classList.contains("is-invalid")).toBe(true);
  });

  it("Search with no departure names what is missing", () => {
    const root = setup("?mode=best", trains);
    search(root);
    expect(root.querySelector(".surprise-msg")!.textContent).toBe(t("need_origin"));
  });
});

describe("browse", () => {
  // 21 direct destinations (past the first chunk of 18), one reachable only via Lyon, and
  // Le Mans reachable only from Massy TGV, 16 km from Paris.
  const direct = Array.from({ length: 20 }, (_, i) => tr("2026-06-25", P, `ZZ D${i + 10}`, "08:00", "10:00", `d${i}`));
  const trains = [
    ...direct,
    tr("2026-06-25", P, "LYON (intramuros)", "08:00", "10:00", "l1"),
    tr("2026-06-25", "LYON (intramuros)", "ZZ VIA", "11:00", "12:00", "v1"),
    tr("2026-06-25", "MASSY TGV", "LE MANS", "09:00", "10:00", "m1"),
  ];

  it("lists direct cards, then via rows, then the nearby section", () => {
    const root = setup(`?mode=from&from=${enc(P)}&date=2026-06-25&rad=40`, trains);
    const kids = [...root.querySelector(".results")!.children];
    const station = (k: Element): string => (k as HTMLElement).dataset.station ?? "";
    const lastDirect = Math.max(...kids.flatMap((k, i) => (/^ZZ D|^LYON/.test(station(k)) ? [i] : [])));
    const via = kids.findIndex((k) => station(k) === "ZZ VIA");
    const nearby = kids.findIndex((k) => k.classList.contains("nearby"));
    expect(lastDirect).toBeGreaterThan(18);
    expect(via).toBeGreaterThan(lastDirect);
    expect(nearby).toBeGreaterThan(via);
  });

  it("names the nearby station a nearby row starts from", () => {
    const root = setup(`?mode=from&from=${enc(P)}&date=2026-06-25&rad=40`, trains);
    const row = root.querySelector('.nearby .group-card[data-station="LE MANS"]')!;
    expect(row.textContent).toContain(t("nearby_from_km", { station: "Massy TGV", km: 16 }));
    expect(row.querySelector(".dest-main-stacked .dest-body")).not.toBeNull();
  });

  it("an empty day points at the next day with seats", () => {
    const root = setup(`?mode=from&from=${enc(P)}&date=2026-06-25`, [
      tr("2026-06-27", P, "LYON (intramuros)", "08:00", "10:00", "1"),
    ]);
    expect(root.querySelector(".results .empty")).not.toBeNull();
    const date = formatDate("2026-06-27");
    const next = button(root, t("day_with_seats", { date }));
    expect(next).toBeDefined();
    next!.click();
    flush();
    expect(location.search).toContain("date=2026-06-27");
    expect(root.querySelector('.results .group-card[data-station="LYON (intramuros)"]')).not.toBeNull();
  });
});

describe("round-trip discovery", () => {
  const trains = [
    tr("2026-06-25", "GAP", "LYON (intramuros)", "07:00", "09:00", "1"),
    tr("2026-06-27", "GAP", "LYON (intramuros)", "07:00", "09:00", "2"),
    tr("2026-06-27", "LYON (intramuros)", "GAP", "18:00", "20:00", "3"),
  ];

  it("names the origin, the day and the stay", () => {
    const root = setup(`?mode=from&from=GAP&date=2026-06-27&stay=day`, trains);
    const title = root.querySelector("#results-title")!.textContent!;
    expect(title).toContain("Gap");
    expect(title).toContain(t("nights_sameday"));
  });

  it("an empty day offers the next day with a round trip and the one-way list", () => {
    const root = setup(`?mode=from&from=GAP&date=2026-06-25&stay=day`, trains);
    expect(button(root, t("getaway_oneway_btn"))).toBeDefined();
    const date = formatDate("2026-06-27");
    button(root, t("day_with_seats", { date }))!.click();
    flush();
    expect(root.querySelector('.results .group-card[data-station="LYON (intramuros)"]')).not.toBeNull();
  });

  it("a day tapped on the form calendar refreshes the list without scrolling to it", () => {
    const root = setup(`?mode=from&from=GAP&date=2026-06-25&stay=day`, trains);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 5000, bottom: 5040 } as DOMRect);
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    root.querySelector<HTMLButtonElement>('.form-cal-mount .cal-cell[data-date="2026-06-27"]')!.click();
    flush();
    expect(root.querySelector('.results .group-card[data-station="LYON (intramuros)"]')).not.toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });
});

describe("a same-day round trip with none that day", () => {
  it("offers the shortest stay that has one", () => {
    const root = setup(
      `?mode=od&from=${enc("MARSEILLE ST CHARLES")}&to=${enc("BORDEAUX ST JEAN")}&date=2026-06-25&stay=day`,
      [
        tr("2026-06-25", "MARSEILLE ST CHARLES", "BORDEAUX ST JEAN", "08:00", "14:00", "1"),
        tr("2026-06-26", "BORDEAUX ST JEAN", "MARSEILLE ST CHARLES", "09:00", "15:00", "2"),
      ],
    );
    button(root, t("try_nights", { n: 1 }))!.click();
    flush();
    expect(location.search).toContain("stay=1");
    expect(root.querySelector(".results .od-return .journey")).not.toBeNull();
  });
});

describe("Ideas", () => {
  const trains = [
    tr("2026-06-25", P, "LYON (intramuros)", "08:00", "10:00", "1"),
    tr("2026-06-26", P, "LILLE", "08:00", "09:00", "2"),
    tr("2026-06-27", P, "PERPIGNAN", "21:25", "08:00", "3"),
  ];
  const ideas = `?mode=best&from=${enc(P)}`;

  it("keeps Recommended as the default sort, and shows the durations", () => {
    const root = setup(ideas, trains);
    const sort = root.querySelector<HTMLSelectElement>(".sort-select")!;
    expect([...sort.options].map((o) => o.value)).toContain("rec");
    expect(sort.value).toBe("rec");
    expect(root.querySelector('.group-card[data-station="LILLE"]')!.textContent).toContain(formatDuration(60));
  });

  it("shows the figure a Most days or Closest sort ranks by", () => {
    const days = setup(`${ideas}&sort=days`, trains);
    expect(days.querySelector('.group-card[data-station="LILLE"]')!.textContent).toContain(t("badge_days", { n: 1 }));
    const closest = setup(`${ideas}&sort=closest`, trains);
    expect(closest.querySelector('.group-card[data-station="LILLE"]')!.textContent).toMatch(/\d+ km/);
  });

  it("opens a destination on the first day it is reachable", () => {
    const root = setup(ideas, trains);
    root.querySelector<HTMLButtonElement>('.group-card[data-station="PERPIGNAN"] .dest-main')!.click();
    flush();
    expect(location.search).toContain("date=2026-06-27");
    expect(root.querySelector(".results .journey")).not.toBeNull();
  });
});
