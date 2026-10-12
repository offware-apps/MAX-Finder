import { describe, it, expect } from "vitest";
import { formatFee, interrailFee, journeyFee } from "../src/data/fees";
import type { Journey, MaxTrain } from "../src/types";

const leg = (origin: string, destination: string, axe?: string): MaxTrain => ({
  date: "2026-10-19",
  origin,
  destination,
  depart: "08:00",
  arrive: "10:00",
  departMin: 480,
  arriveMin: 600,
  durationMin: 120,
  trainNo: "6201",
  available: true,
  axe,
});

describe("Interrail reservation fees", () => {
  it("prices a train by the country abroad, else by its axe", () => {
    expect(interrailFee("SUD EST", "PARIS (intramuros)", "MARSEILLE ST CHARLES")).toEqual({ min: 10, max: 20 });
    expect(interrailFee("INTERNATIONAL", "PARIS (intramuros)", "STUTTGART HBF")).toEqual({ min: 19, max: 19 });
    expect(interrailFee("INTERNATIONAL", "PARIS (intramuros)", "ZURICH HB")).toEqual({ min: 25, max: 25 });
    expect(interrailFee("INTERNATIONAL", "LYON (intramuros)", "TORINO PORTA SUSA")).toEqual({ min: 31, max: 31 });
    expect(interrailFee("INTERNATIONAL", "PARIS (intramuros)", "DIJON VILLE")).toEqual({ min: 10, max: 20 });
    expect(interrailFee("IC NUIT", "PARIS (intramuros)", "BRIANCON")).toEqual({ min: 10, max: 25 });
    expect(interrailFee("AUTOCAR SNCF", "PARIS (intramuros)", "ROUEN RIVE DROITE")).toBeUndefined();
    // Whole words only: Bernay is in Normandy, not Bern.
    expect(interrailFee("NORD", "PARIS (intramuros)", "BERNAY")).toEqual({ min: 10, max: 20 });
  });

  it("adds up a connecting journey's fees, and gives none when one train has none", () => {
    const j = (legs: MaxTrain[]) => ({ legs }) as unknown as Journey;
    expect(journeyFee(j([leg("PARIS (intramuros)", "LYON (intramuros)", "SUD EST"), leg("LYON (intramuros)", "TORINO PORTA SUSA", "INTERNATIONAL")]))).toEqual({ min: 41, max: 51 });
    expect(journeyFee(j([leg("PARIS (intramuros)", "ROUEN RIVE DROITE", "AUTOCAR SNCF")]))).toBeUndefined();
  });

  it("writes a fixed fee as one price and a range as two", () => {
    expect(formatFee({ min: 19, max: 19 }, "en")).toBe("€19");
    expect(formatFee({ min: 10, max: 20 }, "en")).toBe("€10–€20");
  });
});
