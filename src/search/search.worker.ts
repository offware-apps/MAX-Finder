/// <reference lib="webworker" />
// Background search worker. Owns its own copy of the dataset (fetched from the same
// committed snapshot the page uses), runs the heavy per-search compute off the main
// thread, and posts back a cache dump the page merges so its render is a cache hit.

import type { MaxTrain, SearchQuery } from "../types";
import { loadDataset } from "../data/dataset";
import { profileForCard, type DatasetProfile } from "../data/profile";
import { clearConnCaches, dumpConnCaches, type ConnCacheDump } from "../core/connections";
import { warmForQuery } from "./warm";

interface WarmMsg {
  id: number;
  query: SearchQuery;
  today: string;
}

// One dataset per profile (the query's pass decides which), loaded on first use.
const loaded = new Map<string, Promise<MaxTrain[]>>();
function trainsFor(profile: DatasetProfile): Promise<MaxTrain[]> {
  let p = loaded.get(profile.id);
  if (!p) {
    p = loadDataset(profile)
      .then((d) => d.trains)
      .catch(() => []);
    loaded.set(profile.id, p);
  }
  return p;
}

const ctx = self as unknown as {
  postMessage: (m: { id: number; dump: ConnCacheDump | null }) => void;
  onmessage: ((e: MessageEvent<WarmMsg>) => void) | null;
};

ctx.onmessage = (e: MessageEvent<WarmMsg>): void => {
  const { id, query, today } = e.data;
  void trainsFor(profileForCard(query.card)).then((trains) => {
    if (!trains.length) {
      ctx.postMessage({ id, dump: null });
      return;
    }
    // Clear first so the dump carries only THIS search's working set, not everything
    // computed since the worker started.
    clearConnCaches(trains);
    warmForQuery(trains, query, today);
    ctx.postMessage({ id, dump: dumpConnCaches(trains) });
  });
};
