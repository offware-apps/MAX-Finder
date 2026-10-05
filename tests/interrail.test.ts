import { describe, it, expect, afterEach } from "vitest";
import type { RawRecord } from "../src/types";
import { encodeCompact, decodeCompact, isCompact, type TimetableRow } from "../src/data/compact";
import { normalizeRecords } from "../src/data/dataset";
import { INTERRAIL_PROFILE, SNCF_PROFILE, parseCard, profileForCard } from "../src/data/profile";
import { queryFromParams, queryToParams } from "../src/state/store";
import { t, setSeatUnknown } from "../src/i18n";

const row = (date: string, over: Partial<TimetableRow> = {}): TimetableRow => ({
  date,
  origine: "PARIS (intramuros)",
  destination: "LYON (intramuros)",
  heure_depart: "08:00",
  heure_arrivee: "10:00",
  train_no: "6601",
  axe: "SUD EST",
  ...over,
});

describe("compact snapshot", () => {
  it("stores a service once and expands it back to one row per date", () => {
    const dates = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const rows = [
      ...dates.filter((_, i) => i % 3 !== 0).map((d) => row(d)),
      row("2026-10-05", { train_no: "6603", heure_depart: "09:00", heure_arrivee: "11:00", axe: undefined }),
    ];
    const c = encodeCompact(rows);
    expect(c.trains).toHaveLength(2);
    expect(c.stations).toEqual(["PARIS (intramuros)", "LYON (intramuros)"]);
    const back = decodeCompact(JSON.parse(JSON.stringify(c)));
    const key = (r: TimetableRow): string => JSON.stringify([r.date, r.train_no, r.heure_depart, r.axe ?? null]);
    expect(back.map(key).sort()).toEqual(rows.map(key).sort());
  });

  it("recognizes only the compact shape and skips malformed rows", () => {
    expect(isCompact([])).toBe(false);
    expect(isCompact(null)).toBe(false);
    const c = encodeCompact([row("2026-10-01")]);
    expect(isCompact(c)).toBe(true);
    c.trains.push([9, 9, "08:00", "09:00", "1", -1, "1"]);
    expect(decodeCompact(c)).toHaveLength(1);
  });
});

describe("Interrail profile", () => {
  const raw = (od: string, dest = "LYON (intramuros)"): RawRecord =>
    ({ ...row("2026-10-01", { destination: dest }), od_happy_card: od }) as RawRecord;

  it("counts every running train, with or without a MAX seat, international stops included", () => {
    const rows = [raw("NON"), raw("OUI"), raw("NON", "GENEVE")];
    expect(normalizeRecords(rows, INTERRAIL_PROFILE).map((x) => x.available)).toEqual([true, true, true]);
    expect(normalizeRecords(rows, SNCF_PROFILE).map((x) => x.available)).toEqual([false, true, false]);
    expect(INTERRAIL_PROFILE.seatKnown).toBe(false);
  });

  it("reads the compact snapshot file", () => {
    const decoded = INTERRAIL_PROFILE.decode?.(encodeCompact([row("2026-10-01"), row("2026-10-02")]));
    expect(decoded).toHaveLength(2);
    expect(INTERRAIL_PROFILE.decode?.([{ any: 1 }])).toBeNull();
  });

  it("picks the dataset from the pass", () => {
    expect(profileForCard("interrail")).toBe(INTERRAIL_PROFILE);
    expect(profileForCard("jeune")).toBe(SNCF_PROFILE);
    expect(profileForCard("senior")).toBe(SNCF_PROFILE);
    expect(parseCard("interrail")).toBe("interrail");
    expect(parseCard("bogus")).toBe("jeune");
  });

  it("keeps card=interrail through a link", () => {
    const q = queryFromParams(new URLSearchParams("mode=from&from=X&date=2026-10-05&card=interrail"), "2026-10-05");
    expect(q.card).toBe("interrail");
    expect(queryToParams(q).get("card")).toBe("interrail");
  });
});

describe("seat-unknown copy", () => {
  afterEach(() => setSeatUnknown(false));

  it("never claims a MAX seat when the pass's seat is unknown", () => {
    expect(t("res_none")).toContain("MAX");
    setSeatUnknown(true);
    expect(t("res_none")).not.toContain("MAX");
    expect(t("cal_legend")).not.toContain("MAX");
    // Keys without a variant are untouched.
    expect(t("card_senior")).toBe("MAX SENIOR");
  });
});
