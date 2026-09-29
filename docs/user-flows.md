# User flows

The canonical map of what a user can do in MAX Finder and how each flow behaves. Keep
this in sync with the app — see the rule in `AGENTS.md` ("Living documentation"): any
change to a user-facing flow must update this file in the same PR.

## Top level: three tabs + a smart form

A user picks a tab, then fills the form. The tab plus which fields are filled decides the
search (`deriveMode` in `src/app.ts`; dispatch in `renderSearch`).

| Tab | Filled fields | Mode | Flow |
|-----|---------------|------|------|
| **Trip** (`simple`) | From + To | `od` | exact trip (one-way or round trip) |
| **Trip** | only From | `from` | browse / discovery *from* a station |
| **Trip** | only To | `to` | browse *into* a station |
| **Multi-city** (`multi`) | legs or cities | `tour` | a multi-stop tour |
| **Ideas** (`ideas`) | From | `best` | best destinations, ranked |

A typed or linked station resolves when it spells a station's name, id or alias (accents,
case, hyphens, brackets and "St"/"Saint" read alike; a station's own name outranks another's
alias, and the one with trains wins a tie), or when it matches exactly one station. A name
matching several stations, or none, stops Search: the field turns red and a line under
Search names it, so `pierre des` never runs from Tours and an unknown arrival never turns
into a browse from the departure. Search with no departure names that step on the same line.

The **trip-type control** sits beside the date: an **`Aller simple` / `Aller-retour`**
(one-way / round trip) segmented toggle — the same sliding-pill style as the main tabs.
When *Aller-retour* is on, a **nights stepper** appears — `[ − ] N [ + ]` with a "Durée sur
place" label — where **0 = "Journée"** (a same-day round trip, metric = hours on site) and
**N = N nights** at the destination (the return is derived as departure + N, adjustable on
the return calendar). Beside the stepper is a **"Flexible" pill**: tapping it switches the
round trip out of fixed-nights mode so you pick the **exact departure and return on the
Trip-tab calendar** (Ulysse-style). While Flexible is active the fixed-nights stepper stays
**in place but inert (dimmed, buttons disabled)** rather than being removed — so toggling
Flexible never moves the "Durée sur place" label or reflows the row (no layout jump); only
the pill lights up. The inert stepper reads the nights of the range on screen, and the
same-day "Temps minimum sur place" field likewise stays in place, inert. Switching to
Flexible keeps the current stay as the range. The form's stay becomes `flexible`. Tapping the stepper or a segment leaves
Flexible again. The stepper (and the pill) are hidden for one-way. `r` toggles one-way ↔
round trip (keeping the nights count, never Flexible); `1/2/3` switch tabs. Toggling,
stepping, or picking Flexible re-runs in place (no second Search tap when origin +
destination + date are set). Legacy `?rt=day` / `?rt=round` / `?rdate=` deep links still
resolve (rt=day or rdate==date → round trip, stepper on 0; a later rdate → the matching
nights; `rt=round` or an rdate more than 3 nights out → Flexible). Internally the stay maps
to the `StayChoice` model (`sameday`/`n1..n3`/`flexible`); Flexible carries its explicit
return date on `query.returnDate` (URL `stay=flex` + `rdate`).

The **Trip tab's date picker is a live availability calendar on the form itself**
(`repaintFormCalendar` in `src/app.ts`, painted into `refs.formCalendar` via
`render.calendarEl`). It sits under the date + trip-shape row behind a one-tap
**"When to leave?"** header (which also shows the picked departure, on its own line so the
header keeps one height in every trip shape) and is **collapsed by default** so the form
stays short on a phone — one tap opens the month to change the day. A day picked under the
results (either leg's calendar) moves it too.
The header names the calendar once (the in-body `<h3>` is rendered `sr-only` via
`calendarEl`'s `hideTitle`, so "When to leave?" isn't written twice). It **recomputes whenever
anything it is derived from changes** — origin, destination, the Aller simple / Aller-retour
toggle, the nights stepper, **and every filter that feeds the per-day sweeps**: Max
correspondances, the via hub, depart-after / depart-before / arrive-before, the max-duration
cap, the train type, night trains + only-night, overnight stopovers, and the same-day minimum
time on site. So a green day always means *a trip is possible that day* for the current
choice.

**Filters apply LIVE; the route stays staged.** A filter is one deliberate choice, so
changing any of the controls listed above (plus the radius, the trip span, hidden trains and
the Ideas/tour region) runs `applyFilterChange`: it repaints the form calendar **and**
refreshes the results already on screen for that route in place — their own calendars
included — with no second Search tap, and no extra history entry. What a **typed route** edit
does is unchanged: a departure/destination/leg the user hasn't committed stays staged until
Search, and a filter change never smuggles it in (the refresh is skipped whenever the form's
route, legs, cities or date no longer match what is on screen). Two other states also stay
staged, because there is nothing on screen to bring up to date: the bare landing form, and
the post-reload "press Search" prompt.

| State | Builder (reused) | Green means |
|-------|------------------|-------------|
| no origin yet | — (neutral month) | any day, tappable — with a "pick a departure station" hint |
| origin + dest, one-way | `availabilityCalendar` | a departure exists that day (count = trains) |
| origin + dest, same day (0 nights) | `stayCalendar` (hours) | a same-day there-and-back works (count = whole hours on site, rounded down) |
| origin + dest, N nights | `stayCalendar` (nights) | a return exactly N nights later exists (count = N) |
| origin only, one-way | `reachableCountCalendar` | you can leave that day (count = destinations) |
| origin only, round / same day | `getawayIdeas().perDay` | a getaway is possible that day (count = destinations) |

Tapping a green day sets the departure (`query.date` + the form's date field); with both
endpoints filled it also shows/refreshes that day's trip in place. It reuses the same option
helpers (`odJourneyOptsFor` / `getawayOptsFor`) as the real search, so the per-day journey
sweeps hit the warm memo caches; origin typing is debounced. The compact date pill above it
stays as the exact-date / ±flex keyboard entry for power users.

**In Flexible mode the same inline calendar becomes a departure→return RANGE picker**
(`pickFormRange`, driven by `calendarEl`'s `range` option). The **first tap sets the
departure** and arms the calendar for the return (`formRangeAwait`); the **next tap on/after
it sets the return** — `query.returnDate` with `stay: "flexible"` — while an earlier tap just
restarts. A **third tap begins a fresh range**. Every tap runs like a single-day pick (in
place for the same route), so the header, the date pill, the URL and the results always
agree: on an exact route the first tap keeps the current span as the return until the
second tap moves it, and a link with no `rdate` shows the departure + 2 its results propose.
The days between the two endpoints (both `.sel`) get a `.range` band, and while the return
is being chosen hovering previews the pending span (`.preview`). The days count outbound
trains, and while the return is awaited they count return trains, the days before the
departure greyed (a tap there restarts). The collapsed header spells out the two endpoints
("Aller: … → Retour: …", or a "choose the return" prompt in discovery, which proposes no
return); `syncFormFromQuery` restores the highlighted range from `stay=flex` + `rdate`. Fixed-nights and one-way modes keep the single-date departure picker; only Flexible
turns on range selection. The results-page return calendar still handles the return too —
this only adds the pick on the **first page**.

**Max correspondances** (0 / 1 / 2 / 3 / no limit) is a **main-form field**, not buried in
Advanced. **Night trains are included by default.** On the results screen, once a specific
date is chosen the possible-days calendar is **collapsed by default** (one tap to reveal
other dates); it stays expanded only during discovery (no exact date/destination yet).

**Every exact-route calendar is graded by the sweep its list runs** — `odJourneyOptsFor`
returns both the connection options and the accept-filter, and the one-way calendar, the
round-trip **return** calendar and the form calendar all use it, so the Advanced **max trip
span (days)** cap narrows the green days exactly as it narrows the trains. Before this the
span applied to the lists only, and a day could read green while its list was empty.

## Trip tab

1. **From + To, One-way** → exact one-way trip (`runOdSearch`). The 30-day availability
   calendar is **collapsed by default** behind a "Departure: <date> · Change" toggle (the
   date is already chosen; the strip only re-appears on tap), above the selected day's train
   list. Tap a green day to move; tap a train to book (direct → deep link; connecting →
   step-by-step).
2. **From + To, a stay chosen** → the round-trip flow (`runTripSearch`). Two-leg accordion,
   with linked calendars:
   - **Leg 1 Outbound** — possible-days calendar collapsed as "Departure: <date> · Change"
     (it mirrors the form date, never re-asks it); below it the day's outbound trains.
     Clicking a departure day **restarts the return calendar from that day** (departure + N
     for a fixed stay, else same-day-first). Pick a train → it collapses to a ✓ summary and…
   - **Leg 2 Return** opens (gently revealed only if below the fold — a calendar tap never
     scrolls the drawer up) — a return calendar whose **first cell is the same day** (hours
     on site), later cells are nights at the destination, pre-selected to the stay's return.
     The list puts first the latest return home by midnight (the most time there — the same
     trip a discovery card counts), and a stay from the last bookable day keeps its return
     past the window, where the return leg says there is none.
     For a **fixed** N-night stay the return is derived with no second question, so its
     calendar is **collapsed by default** behind a "Return: <date> · Change" toggle (same
     `.cal-collapsible` / `.cal-toggle` / `.cal-panel` pattern as the outbound one). In
     **Flexible** mode the return calendar **stays open** (it is the return-length control):
     tapping a day sets `query.returnDate` and keeps the stay `flexible`. **Exception** —
     when the proposed return day has **no free-MAX return**, the return leg and its calendar
     **open by default** (never a collapsed summary hiding an empty list), so the days that
     *do* have a return are visible and one tap away. Pick a return →
   - **Same day with no round trip that day** → under the empty outbound, a one-tap "Stay N
     night(s) instead" offers the shortest stay (1–3 nights) that has one that day.
   - **Trip modal** = booking recap: each leg's own **travel date** rides on the ticket header
     (beside "Outbound" / "Return"), and an unmistakable per-leg action — "Book the outbound" /
     "Book the return" (each deep-links SNCF Connect; a connecting leg opens the step modal)
     — plus Save the whole trip. Back inside the accordion re-opens the outbound before it
     exits the flow (step-wise back).
3. **Only From, One-way** → browse (`runBrowse` "from"). Every destination reachable from the
   station, ranked by how well-served it is, with availability. Tap a card → the exact trip.
   The list reads direct cards, then connection-only ("via") rows, then the radius "Stations
   within N km" section, whatever the chunked rendering. A nearby row names the station its
   free leg starts from ("from Massy TGV · 16 km"). An empty day offers a one-tap move to
   the next day with seats.
4. **Only From, a stay chosen** → discovery (`runGetaways`), titled with the origin, the day
   and the stay ("Round trips from Paris — Tue, Sep 29 · Same day"; the mobile search bar
   repeats it). Destinations ranked by **time at the destination** (hours on site if same-day
   is best, else nights); the form's calendar shows the possible start days. Tap a day →
   narrows to that day and scrolls the list into view when it sits below the fold. Tap a
   destination → opens the round trip. An empty day offers the next day with a round trip
   and a one-tap switch to one-way.
   - Ranking: `sortGetaways` puts most hours-on-site first for same-day trips.
   - A minimum-on-site gate exists in core (`minOnSiteMin`, default 4h); NOT yet exposed as
     an Advanced control. (Open item.)
5. **Only To** → reverse browse (`runBrowse` "to"): where you can come *from* to reach the
   station. With a **round trip / stay** chosen and only a destination, this is a **reverse
   round-trip discovery** — the origins you can round-trip *from* to reach this station,
   with a possible-departure-days calendar — never a blank screen.

## Multi-city tab (tour)

- **Custom legs** — spell out each hop (from → to @ date). "Surprise me" fills a random
  reachable next stop; can build a whole trip from an empty editor.
- **Tour planner** — add cities to visit (or "Surprise" / "Nearest stop"), set days-per-city;
  it auto-orders a feasible tour. Save as a tour.

## Ideas tab (best)

Every free-MAX destination from the origin across the booking window (there is no one-day
view), fastest first; the sort picker also ranks by most trains, most days, closest or A–Z.
Each row shows the changes, the month's train count and the fastest time, plus the days
reachable or the distance when the sort ranks by it. Tap → the exact trip on the first day
the destination is reachable, with its calendar open.

## Cross-cutting (everywhere)

- **Map** — full-bleed behind a results drawer on mobile, side panel on desktop. Markers per
  destination, hover/selection synced with the list; route line for exact trips; auto-fits
  above the drawer on mobile.
- **Saved & Favorites** — star a route / save a trip, from the header menu. (The two overlap
  — a known cleanup item.)
- **Settings** — theme, MAX Jeune/Senior, comfortable/compact, and Low-end mode (map off +
  reduced motion + compact) with a one-time nudge on weak devices; language. MAX SENIOR is
  weekday-only, so every calendar greys its weekends (a weekend list keeps its notice).
- **Mobile** — the form is a sheet that collapses to a search bar; results are a bottom-sheet
  drawer with detents. Back navigation preserves form state and never lands on a dead screen.
- **History model** — a genuine navigation (Search, drilling into a route, opening the saved
  page) pushes **one** history entry carrying a form snapshot, so browser Back returns to the
  prior page with the form intact. Refining the current view — the Aller simple/retour toggle,
  the nights stepper, the Flexible pill, picking a calendar day — updates **in place**
  (`replaceState`), never pushing a new entry. So repeated toggling can't pile up duplicate
  entries (the old bug where Back needed ~10 presses and the form appeared wiped).
- **Deep links** — every search is a shareable URL; legacy `?rdate=` / `?rt=` links still work.
  A station may be named in any case or accent (`from=paris`, `to=LILLE`) and resolves to
  the station that has trains; a name matching no station shows "Unknown station" instead
  of an empty result. A malformed or out-of-window departure date falls back to today; a
  malformed or out-of-window return or finish-by date, and a malformed time filter, are
  dropped. The address bar is then corrected in place (`replaceState`) to match the screen.
  A link without `card=` (a route page's "open in app") keeps the card saved in Settings.
- **PWA** — installable; a "new version — reload" postcard on updates.

## Known open items (see docs/trip-redesign.md for the audit plan)

- Expose the minimum-time-on-site gate in Advanced (discovery).
- Collapse the two save systems (favorite star + Save bookmark) into one.
- One `openRoute()` primitive (list cards / favorites / map pins behave consistently).
- One home for the availability calendar (form popover vs results).
- Mobile browser-Back should close detail pages via history.
