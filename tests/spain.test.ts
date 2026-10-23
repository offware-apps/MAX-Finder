import { describe, it, expect, afterEach, vi } from "vitest";
import { encodeCompact, type TimetableRow } from "../src/data/compact";
import { loadDataset, operatorTrains } from "../src/data/dataset";
import { INTERRAIL_PROFILE, SNCF_PROFILE } from "../src/data/profile";
import { RENFE, operatorById } from "../src/data/operators";
import { findJourneys } from "../src/core/connections";
import { journeyFee } from "../src/data/fees";
import { prettyLabel } from "../src/data/stations";

const BASE = "https://api.test/v1";
const NOW = new Date("2026-10-01T09:00:00Z");
const DATE = "2026-10-02";
const MADRID = "Madrid-Puerta de Atocha-Almudena Grandes";

const row = (origine: string, destination: string, dep: string, arr: string, no: string, axe?: string): TimetableRow => ({
  date: DATE,
  origine,
  destination,
  heure_depart: dep,
  heure_arrivee: arr,
  train_no: no,
  ...(axe ? { axe } : {}),
});

// SNCF: Paris → Barcelona by TGV. Renfe: Barcelona → Madrid by AVE, and a Renfe train
// into France that SNCF's feed also carries (kept once).
const sncf = encodeCompact([
  row("PARIS (intramuros)", "BARCELONA SANTS", "10:07", "16:36", "9713", "INTERNATIONAL"),
  row("PARIS (intramuros)", "LYON (intramuros)", "08:00", "10:00", "6601", "SUD EST"),
  row("BARCELONA SANTS", "LYON (intramuros)", "09:00", "14:00", "9742", "INTERNATIONAL"),
]);
const renfe = encodeCompact([
  row("Barcelona-Sants", MADRID, "17:30", "20:15", "03171", "AVE"),
  row("Barcelona-Sants", "Lyon Part Dieu", "09:00", "14:00", "09742", "AVE INT"),
  row("Barcelona-Sants", "Perpignan", "09:00", "10:20", "09742", "AVE INT"),
]);

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
const stub = (renfeUp = true): unknown =>
  vi.stubGlobal("fetch", (url: string) => {
    if (url === `${BASE}/sncf/interrail/all.json`) return Promise.resolve(json(sncf));
    if (url === `${BASE}/renfe/interrail/all.json`)
      return renfeUp ? Promise.resolve(json(renfe)) : Promise.reject(new Error("offline"));
    if (url === `${BASE}/index.json`) return Promise.resolve(json({ updatedAt: "2026-10-01T08:00:00Z" }));
    return Promise.resolve(new Response("", { status: 404 }));
  });

afterEach(() => vi.unstubAllGlobals());

describe("Renfe on Interrail", () => {
  it("joins Renfe's stations SNCF also serves to SNCF's ids", () => {
    const trains = operatorTrains(renfe, RENFE, INTERRAIL_PROFILE, ["BARCELONA SANTS", "LYON (intramuros)", "PERPIGNAN"]);
    expect(trains.map((t) => [t.origin, t.destination])).toEqual([
      ["BARCELONA SANTS", MADRID],
      ["BARCELONA SANTS", "LYON (intramuros)"],
      ["BARCELONA SANTS", "PERPIGNAN"],
    ]);
    expect(trains.every((t) => t.operator === "renfe" && t.available)).toBe(true);
  });

  it("adds Renfe's trains to Interrail, keeping a train both feeds carry once", async () => {
    stub();
    const d = await loadDataset(INTERRAIL_PROFILE, BASE, NOW);
    expect(d.trains).toHaveLength(5);
    expect(d.trains.filter((t) => t.origin === "BARCELONA SANTS" && t.destination === "LYON (intramuros)")).toHaveLength(1);
    expect(d.trains.find((t) => t.destination === MADRID)?.operator).toBe("renfe");
    expect(d.meta.recordCount).toBe(5);
  });

  it("finds Paris → Madrid with a change at Barcelona", async () => {
    stub();
    const d = await loadDataset(INTERRAIL_PROFILE, BASE, NOW);
    const [j] = findJourneys(d.trains, "PARIS (intramuros)", MADRID, DATE);
    expect(j?.hubs).toEqual(["BARCELONA SANTS"]);
    expect(j?.legs.map((l) => l.operator)).toEqual([undefined, "renfe"]);
    // The fee table covers SNCF only: no estimate for a journey with a Renfe train.
    expect(j && journeyFee(j)).toBeUndefined();
  });

  it("shows SNCF's trains alone when Renfe's file is out of reach", async () => {
    stub(false);
    const d = await loadDataset(INTERRAIL_PROFILE, BASE, NOW);
    expect(d.trains).toHaveLength(3);
    expect(d.trains.some((t) => t.operator)).toBe(false);
  });

  it("never asks Renfe for the MAX passes", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return Promise.resolve(json({}));
    });
    await loadDataset(SNCF_PROFILE, BASE, NOW);
    expect(urls.some((u) => u.includes("/renfe/"))).toBe(false);
  });

  it("books a Renfe train on Renfe's site and keeps its station names", () => {
    expect(operatorById("renfe")?.bookingUrl).toContain("renfe.com");
    expect(operatorById(undefined)).toBeUndefined();
    expect(prettyLabel(MADRID)).toBe(MADRID);
    expect(prettyLabel("BARCELONA SANTS")).toBe("Barcelona Sants");
  });
});

describe("Spanish station names", () => {
  it("resolves a city name to its main station once Renfe's trains are in", async () => {
    const { StationRegistry } = await import("../src/data/stations");
    const r = new StationRegistry([]);
    r.addMissing([MADRID, "Madrid-Chamartín-Clara Campoamor", "BARCELONA SANTS", "Barcelona-Passeig de Gràcia"]);
    expect(r.resolve("madrid")).toBeUndefined(); // two Madrid stations: ambiguous
    r.addAliases(RENFE.aliases);
    expect(r.resolve("Madrid")).toBe(MADRID);
    expect(r.resolve("barcelone")).toBe("BARCELONA SANTS");
    expect(r.coords(MADRID)).toEqual([40.407, -3.691]);
  });
});
