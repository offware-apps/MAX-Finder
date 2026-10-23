import type { RawRecord, MaxTrain, DataMeta } from "../types";
import { parseTimeToMinutes, minutesToHHMM } from "../util/time";
import { normalizeText } from "./stations";
import { SNCF_PROFILE, type DatasetProfile, type RawSourceRecord } from "./profile";
import { decodeCompact, isCompact, type CompactSnapshot } from "./compact";
import type { Operator } from "./operators";
import { setNetworkHubs } from "../core/connections";
import sampleData from "../../data/tgvmax.sample.json";

/** Accent-insensitive substring match of a station name against a pattern list. */
function matchesPattern(name: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const n = normalizeText(name);
  return patterns.some((p) => n.includes(p));
}

/**
 * Normalize one raw record into a `MaxTrain`, reading fields and the "bookable"
 * rule through a {@link DatasetProfile} (default: SNCF). Returns null if invalid.
 */
export function normalizeRecord(r: RawRecord, profile: DatasetProfile = SNCF_PROFILE): MaxTrain | null {
  if (!r) return null;
  const f = profile.read(r as unknown as RawSourceRecord);
  const origin = f.origin;
  const destination = f.destination;
  if (!origin || !destination || !f.date) return null;
  if (origin === destination) return null; // skip self-loops (X → X)
  const departMin = parseTimeToMinutes(f.depart ?? "");
  let arriveMin = parseTimeToMinutes(f.arrive ?? "");
  if (Number.isNaN(departMin) || Number.isNaN(arriveMin)) return null;
  if (arriveMin < departMin) arriveMin += 1440; // crosses midnight
  // Bookable only if the source's rule says so AND neither endpoint is a
  // non-bookable (e.g. international) stop the pass doesn't cover.
  const reservable = profile.isReservable(r as unknown as RawSourceRecord);
  const excluded =
    matchesPattern(origin, profile.nonBookablePatterns) ||
    matchesPattern(destination, profile.nonBookablePatterns);
  return {
    date: f.date,
    origin,
    destination,
    depart: minutesToHHMM(departMin),
    arrive: minutesToHHMM(arriveMin),
    departMin,
    arriveMin,
    durationMin: arriveMin - departMin,
    trainNo: f.trainNo ?? "",
    available: reservable && !excluded,
    axe: f.category,
  };
}

export function normalizeRecords(rows: RawRecord[], profile: DatasetProfile = SNCF_PROFILE): MaxTrain[] {
  const out: MaxTrain[] = [];
  for (const r of rows) {
    const n = normalizeRecord(r, profile);
    if (n) out.push(n);
  }
  return out;
}

export interface Dataset {
  trains: MaxTrain[];
  meta: DataMeta;
  /** The {@link DatasetProfile} these trains were read with (omitted = SNCF MAX). */
  profile?: DatasetProfile;
  /** The train-api base the trains (or some of them) came from; empty when all came from the snapshot. */
  apiBase?: string;
}

/**
 * Fetch and parse JSON. `timeoutMs` bounds the wait for the response headers only: once
 * the server answers, the body downloads at the link's own pace.
 */
async function fetchJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const ctl = timeoutMs ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : undefined;
  let res: Response;
  try {
    res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** An unreachable train-api must not hold the app up: past this, use the snapshot. */
const TRAIN_API_TIMEOUT_MS = 8000;

/** train-api publishes daily; past this age it has stopped refreshing. */
const TRAIN_API_MAX_AGE_MS = 36 * 3600 * 1000;

interface ApiTimetable {
  rows: RawRecord[];
  meta: DataMeta;
  /** Older than {@link TRAIN_API_MAX_AGE_MS}, or every date already past. */
  stale: boolean;
}

/**
 * Read a pass's timetable from train-api. Every train in a pass's file is bookable with
 * that pass, so rows carry the MAX flag the profiles read. Null when it is off,
 * unreachable or malformed.
 */
async function fromTrainApi(profile: DatasetProfile, base: string, now: Date): Promise<ApiTimetable | null> {
  if (!base || !profile.trainApiPass) return null;
  try {
    const [json, index] = await Promise.all([
      fetchJson<unknown>(`${base}/sncf/${profile.trainApiPass}/all.json`, TRAIN_API_TIMEOUT_MS),
      fetchJson<{ updatedAt?: unknown }>(`${base}/index.json`, TRAIN_API_TIMEOUT_MS).catch(() => null),
    ]);
    if (!isCompact(json)) return null;
    const rows = decodeCompact(json).map((r) => ({ ...r, od_happy_card: "OUI" }) as unknown as RawRecord);
    if (rows.length === 0) return null;
    const updatedAt = typeof index?.updatedAt === "string" ? index.updatedAt : "";
    const age = now.getTime() - Date.parse(updatedAt);
    const lastDate = json.dates.reduce((a, d) => (d > a ? d : a), "");
    const stale = age > TRAIN_API_MAX_AGE_MS || lastDate < now.toISOString().slice(0, 10);
    return { rows, meta: { updatedAt, source: "train-api", recordCount: rows.length, isSample: false }, stale };
  } catch {
    return null;
  }
}

/**
 * One other operator's timetable for a pass from train-api, or null when it is off,
 * unreachable, malformed or entirely in the past. There is no snapshot to fall back to:
 * without it, the pass shows SNCF's trains alone.
 */
async function operatorFromTrainApi(op: Operator, pass: string, base: string, now: Date): Promise<CompactSnapshot | null> {
  try {
    const json = await fetchJson<unknown>(`${base}/${op.id}/${pass}/all.json`, TRAIN_API_TIMEOUT_MS);
    if (!isCompact(json)) return null;
    const lastDate = json.dates.reduce((a, d) => (d > a ? d : a), "");
    return lastDate >= now.toISOString().slice(0, 10) ? json : null;
  } catch {
    return null;
  }
}

/**
 * Another operator's trains, normalized like SNCF's and tagged with the operator. A
 * station SNCF also serves takes SNCF's id (`sncfIds`), by the operator's own mapping or
 * by name with accents, case and punctuation aside, so journeys can change trains there.
 */
export function operatorTrains(
  json: CompactSnapshot,
  op: Operator,
  profile: DatasetProfile,
  sncfIds: Iterable<string>,
): MaxTrain[] {
  const byName = new Map<string, string>();
  for (const id of sncfIds) byName.set(normalizeText(id), id);
  const stations = json.stations.map((name) => op.sncfNames[name] ?? byName.get(normalizeText(name)) ?? name);
  const rows = decodeCompact({ ...json, stations }) as unknown as RawRecord[];
  const trains = normalizeRecords(rows, profile);
  for (const tr of trains) tr.operator = op.id;
  return trains;
}

/**
 * Load a {@link DatasetProfile}'s trains (default: SNCF MAX), see {@link loadSncf}, with
 * the trains of the profile's other operators from train-api added when they answer. A
 * train both feeds carry (same stations, date and times) is kept once, as SNCF's.
 */
export async function loadDataset(profile: DatasetProfile = SNCF_PROFILE, apiBase = "", now = new Date()): Promise<Dataset> {
  const pass = profile.trainApiPass;
  const others = Promise.all(
    (apiBase && pass ? profile.operators ?? [] : []).map(async (op) => ({ op, json: await operatorFromTrainApi(op, pass ?? "", apiBase, now) })),
  );
  const dataset = await loadSncf(profile, apiBase, now);
  let trains = dataset.trains;
  if (!dataset.meta.isSample) {
    const sncfIds = new Set(trains.flatMap((tr) => [tr.origin, tr.destination]));
    const key = (tr: MaxTrain): string => `${tr.date} ${tr.origin} ${tr.destination} ${tr.depart} ${tr.arrive}`;
    const seen = new Set(trains.map(key));
    for (const { op, json } of await others) {
      if (!json) continue;
      const extra = operatorTrains(json, op, profile, sncfIds).filter((tr) => !seen.has(key(tr)));
      trains = trains.concat(extra);
    }
  }
  // The profile's interchange stations, for every search over these trains.
  setNetworkHubs(trains, profile.hubs);
  if (trains === dataset.trains) return dataset;
  // Some trains came from train-api, so the search worker must read it too to hold the same.
  return { ...dataset, trains, apiBase, meta: { ...dataset.meta, recordCount: trains.length } };
}

/**
 * Load a profile's SNCF trains: from train-api at `apiBase` when it answers with a fresh
 * timetable, else the committed daily snapshot, else a stale train-api timetable
 * (offline, from the service worker's cache), else the bundled sample fixture, so the
 * app always has something to show.
 */
async function loadSncf(profile: DatasetProfile, apiBase: string, now: Date): Promise<Dataset> {
  const api = await fromTrainApi(profile, apiBase, now);
  const fromApi = (a: ApiTimetable): Dataset => ({ trains: normalizeRecords(a.rows, profile), meta: a.meta, profile, apiBase });
  if (api && !api.stale) return fromApi(api);
  const meta = await fetchJson<DataMeta>(profile.metaUrl).catch(() => null);
  const json = await fetchJson<unknown>(profile.dataUrl).catch(() => null);
  let rows = (profile.decode ? profile.decode(json) : json) as RawRecord[] | null;
  let usedSample = false;
  // Guard the shape too: a malformed snapshot (e.g. an error object instead of an
  // array) would otherwise slip past a length check and crash normalizeRecords.
  if (!Array.isArray(rows) || rows.length === 0) {
    if (api) return fromApi(api);
    rows = sampleData as RawRecord[]; // bundled fixture: app still works offline
    usedSample = true;
  }
  const trains = normalizeRecords(rows, profile);
  return {
    trains,
    profile,
    apiBase: "",
    // Metadata describes the snapshot, so it no longer applies once the sample stands in.
    meta:
      meta && !usedSample
        ? meta
        : ({
            updatedAt: "",
            source: usedSample ? "sample" : "unknown",
            recordCount: trains.length,
            isSample: usedSample,
          } as DataMeta),
  };
}
