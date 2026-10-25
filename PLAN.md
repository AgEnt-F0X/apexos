# PLAN — System Upgrade: Data Platform, Engineering Dashboard, Cinematic Replay

> **⚠️ RENAME PENDING** — "APEX//OS" collides with existing projects (`adi21anand/APEX`,
> plus other "Apex OS" products). Working candidates below (§7); all references here are
> placeholder until the user picks.

**Status:** Proposed · supersedes the roadmap sections in `README.md` / `PROJECT.md`
**North star:** *Every byte the OpenF1 API offers is ingested, processed into insight, and either
performed on the 3D stage or made explorable in a data-engineering-grade dashboard.*

---

## 0. Guiding architecture after this upgrade

```
                        ┌──────────────────────────────────────────────┐
   SOURCES              │  INGESTION PLATFORM                          │
   OpenF1 (14+ ep) ────▶│  rate-limited client · watermarked sync      │
   Jolpica-F1 ─────────▶│  · recovery sweeps · CSV bulk mode           │
   circuit cache ──────▶│        │                                     │
                        │        ▼                                     │
                        │  NORMALIZED STORE                            │
                        │  APEXPACK v2 (versioned schema)              │
                        │  IndexedDB object-stores / endpoint          │
                        │        │                                     │
                        │        ▼                                     │
                        │  DERIVED METRICS ENGINE                      │
                        │  tire deg · pace maps · undercuts · drama    │
                        │        │                                     │
                        └────────┼─────────────────────────────────────┘
                                 │
                 ┌───────────────┴────────────────┐
                 ▼                                ▼
       THE THEATRE (3D)                 ENGINEERING DASHBOARD (2D)
       cached circuits                  TanStack Query · Table · Virtual
       driver indicators                (+ swappable component kit)
       comparison ghosts                dossier / h2h / strategy / logs
       story modes                      lap-record explorer
```

One pipeline, two consumers. The theatre performs; the dashboard explains.
Both read the same normalized store and the same metrics engine — no duplicated logic.

---

## 0.5 UI Direction — "The Museum Plinth" (confirmed with user)

**Brief:** minimalist white-space aesthetic, track centered, isometric design style.

**Good news:** the codebase already pivoted here — `Theatre.tsx` renders a `#eef1f5`
gallery-white void, `CameraRig.tsx` is an orthographic turntable, `Plinth.tsx` exists,
`tokens.css` defines ink hairlines + one red voice on porcelain ground. The abandoned
neon/tactical pitch in old docs is dead; this plan completes the porcelain direction
instead of fighting it.

**The idea, stated precisely:** *the race as a museum scale-model.* Not a game level, not
a broadcast graphic — an architectural maquette of a Grand Prix, exhibited in infinite
white light:

1. **The diorama** — track ribbon sits on a shallow plinth at screen center, orthographic
   camera at a fixed elevated angle (~30–35°, near-isometric but legibility-tuned). Idle =
   imperceptibly slow turntable drift; interaction = user orbits within clamped elevations.
   No perspective distortion drama; the model reads like an object you could pick up.
2. **Cars as specimens** — minimal tokens (existing wedge geometry), team-colored but
   desaturated to sit in the palette; indicators are *labels on pins*, like specimen tags
   in a vitrine: number, code, compound chip. Nothing floats free of the model.
3. **Ink annotation system** — all chrome is hairline ink on white: mono small-caps labels,
   leader lines that touch the model only where they explain something. Museum-label
   typography for the story feed. The one red voice is reserved exclusively for live race
   state: flags, battle-bridge tension, DNF marks.
4. **Density = depth of curation** — CINEMA strips to diorama + subtitles;
   BROADCAST adds the timing tower and labels; ENGINEER opens the archive room: the
   dashboard surfaces slide in over/beside the same white ground. One continuous material
   world — the lab never becomes a different app.
5. **X-ray = curator mode** — hold X and the museum explains itself: lineage notes appear
   as engraved plaques beside each element.
6. **Dashboard shares the gallery** — Bklit charts restyled to ink-on-porcelain (hairline
   axes, no chartjunk, red only for alarm/action). Tables are ruled lists, not boxed grids.
   White space does the grouping — no card borders unless a panel must float over the 3D
   view.

**What this rules out:** glassmorphism, neon glow, bloom, dark-mode dashboard clichés,
perspective chase cams as the default. (Director's follow-cam may temporarily break the
isometric frame for drama — treat it as a deliberate exhibit moment, returning to the plinth.)

---

## 0.7 Product Flow — what a person actually finds when they open this

### The journey (first visit)

```
 ┌──────────────────────────────────────────────────────────────────┐
 │ 1. ARRIVAL — white void, the plinth fades in with last/featured  │
 │    race already idling on it (hero pack = zero-wait diorama).    │
 │    One line of copy. Two actions: ▶ WATCH · EXPLORE              │
 ├──────────────────────────────────────────────────────────────────┤
 │ 2. BRIEFING (first run only, ~30s, skippable) — three cards:     │
 │    what this is · the Density Dial · press X anytime.            │
 │    Replaces a manual you're forced to read before touching.      │
 ├──────────────────────────────────────────────────────────────────┤
 │ 3. THEATRE (default destination — watch first)                   │
 │    BROADCAST density on. Director starts cutting.                │
 │    Every other surface hangs off THIS screen, never replaces it. │
 ├──────────────────────────────────────────────────────────────────┤
 │ 4. DRILL-DOWN (user-driven curiosity paths)                     │
 │    click a car → FocusPanel → "open dossier @ 1:12:44"           │
 │    click a battle bridge → Head-to-Head preloaded with that pair │
 │    click a flag band on DNA strip → Race Control Log filtered    │
 ├──────────────────────────────────────────────────────────────────┤
 │ 5. THE CATALOGUE (?) — always one keypress away, never blocking  │
 └──────────────────────────────────────────────────────────────────┘
```

**Principle: the diorama is home.** No splash screens, no dashboards-first onboarding.
A stranger's first 10 seconds are a beautiful object moving — the thesis demonstrated
before it is explained.

### Navigation graph

```
                    ┌────────────────┐
     first run ───▶ │ BRIEFING       ├──▶ (never again unless ?)
                    └────────────────┘
 ┌───────────┐   pick session   ┌─────────────────────────────────┐
 │  LOBBY /  │─────────────────▶│           THEATRE               │
 │  ARCHIVE  │◀───── back ──────│  diorama + density dial         │
 │ (browser, │                  │                                 │
 │ calendar, │      pick        │   ┌─────────── LAB OVERLAYS ───┐│
 │ rankings) │───── drivers ───▶│   │ Dossier·H2H·Strategy·RC·   ││
 └───────────┘                  │   │ Standings (clock-synced)   ││
       ▲                        │   └────────────────────────────┘│
       │ live detected          │  ? → CATALOGUE (any screen)     │
       └────────────────────────┴─────────────────────────────────┘
```

- **LOBBY** merges today's `SessionBrowser` with the new intelligence: a LIVE card when a
  session is on track (polls OpenF1 session list, cheap), drama-ranked featured races,
  latest-results strip, season calendar view.
- **Deep links** (`#/session/9843/driver/VER`, `#/session/9843/lab/h2h?drivers=VER,HAM`)
  make every moment shareable — mandatory for a portfolio piece.
- **Failure is designed:** API unreachable + no cached pack → lobby shows curated packs
  only with an honest banner; theatre load failure keeps its actionable fault panel.

### The one rule that makes everything cohere

## ⏱ THE ONE TIME CURSOR

> **RaceClock's `t` is the single x-coordinate of the entire product.**
> Scrubbing the DNA strip moves the diorama, the dossier's deg curves, the H2H gap chart,
> the strategy Gantt, the RC log filter — everything, simultaneously. Nothing in the LAB
> has its own timeline control; they all *are* views of one moment.

This answers the "visualization must be dynamic with the race" requirement at the root:

| Mode | What "live" means |
|---|---|
| Replay | panels re-render as clock scrubs/plays — charts animate through history |
| Directed | temporal lensing drives the same cursor; panels compress/stretch with it |
| **Live race** | watermark polling extends `tMax`; every surface streams forward in lockstep (~3s behind reality) |

Implementation: surfaces subscribe to clock ticks (throttled ~5–10 Hz for canvas, on-change
for tables); metrics engine exposes window queries (`metricsAt(t)`), not whole-session dumps.
TanStack Query keys carry `(sessionId, metricId, tWindow)` so cache stays coherent.

---

## Phase 0 — Stabilize & verify (prerequisite for everything)

The audit (`AUDIT.md`) found the build is ~72% of scoped v1 with integrity debt. Do not
stack new systems on unverified ground.

| # | Task | Where | Done when | Status |
|---|------|-------|-----------|--------|
| 0.1 | First-ever human browser pass: WebGL rendering, shaders, camera feel, all five patterns | manual | Screenshot log committed to `docs/verification/` | ⏳ **user checklist issued** |
| 0.2 | Fix Join-as-Live scrub freeze (pointer-down sets `scrubbing` → freezes `tick`) | `src/ui/DnaStrip.tsx`, `RaceClock.ts` | DNA drag never pauses broadcast-locked clock | ✅ DVR seek: rewind allowed, ahead refused; drag past live edge snaps; gravity filtered |
| 0.3 | Delete every claim without a code referent (undercuts, TV-truck Director, etc.) | `About.tsx`, README, PROJECT.md | Cold-reader test from audit passes | ✅ undercuts claim removed ×3 sites; Director re-described as plate/follow/pair grammar |
| 0.4 | Remove unused `@react-three/postprocessing` dep | `package.json` | clean install | ✅ uninstalled, typecheck green |
| 0.5 | Commit history begins | git | decision trail recoverable | 🚫 dropped by owner decision |

---

## Phase 1 — Data Platform v2: ingest everything OpenF1 offers

### 1.1 Endpoint coverage matrix

Currently consumed: `meetings`, `sessions`, `drivers`, `location`, `car_data`, `laps`,
`stints`, `pit`, `race_control`, `weather`, `team_radio`, `position`, `intervals`.

To add (verified against the live API during planning):

| Endpoint | New fields of value | Consumer | Status |
|---|---|---|---|
| `session_result` | final classification, **points**, **DNF/DNS/DSQ flags**, `gap_to_leader`, race duration | dossier result header, end-of-race ceremony (pending), story feed verdicts (pending) | ✅ ingested into APEXPACK v4 + `scripts/upgrade-packs.ts` migration; both hero packs MATCH official top-5 |
| Championship standings | live driver/constructor points through each race | dashboard standings board; season view | ✅ client (`jolpica.ts`) — consumers pending Phase 2 |
| Remaining of the advertised 18 endpoints | TBD | contract-test script enumerates them | ⬜ |
| `csv=true` bulk mode on any request | cheaper large pulls | ingestion worker for cold loads | ⬜ |

### 1.2 Ingestion upgrades

- **Contract tests:** `scripts/probe-endpoints.ts` — hits every documented endpoint shape,
  records row schemas, fails CI if OpenF1 changes shape. The 2024 URL-encoding bug class
  gets caught here forever.
- **Watermark sync:** every table fetch stores `lastSyncedDate`; incremental refreshes query
  `date>` the watermark instead of refetching windows (also the primitive live needs later).
- **CSV lane:** big historical pulls use `csv=true` where profiling shows wins.
- **Jolpica-F1 source (verified working):** `api.jolpi.ca/ergast/*` — Ergast-compatible,
  free, serves current seasons. Adds what OpenF1 cannot: **results/standings/schedules back
  to 1950**, constructor/driver career tables, season calendars. Stored in separate IndexedDB
  object-stores; powers Phase 2 season views and Phase 4 lap-record explorer.
  ✅ **client shipped** — `src/data/jolpica.ts`: single sequential lane (400 ms spacing),
  localStorage cache w/ TTL, typed shapes, null-on-failure enrichment contract.
  ⬜ IndexedDB object-store persistence + Query wiring lands with Phase 2 panels.
- **F1 Connect / f1api.dev source (verified working):** free Ergast-style API. Overlaps
  Jolpica on most things, but uniquely exposes **circuit metadata**: `lapRecord` +
  record-holder driver/team/year, `corners`, `circuitLength`,
  `firstParticipationYear`. Use it narrowly as an **enrichment feed** — attach lap-record
  and corner-count data to circuit cache artifacts (1.5), power the lap-record explorer,
  annotate session browser cards. Do not build a third full ingestion lane around it;
  Jolpica remains the primary history source.
  ✅ **client shipped** — `src/data/circuitMeta.ts` with OpenF1→f1api slug alias map +
  fuzzy fallback; failed pulls are never cached sticky (retry next call).
- **Rate-limit budget ledger:** shared token bucket across both APIs (OpenF1 free tier:
  3 req/s, 30 req/min — respect both axes), visible in the dashboard as a "pipeline health"
  panel.

### 1.3 APEXPACK v4 *(shipped 2026-08-14 night)*

- ✅ Schema version header + **backward-compatible decoder** — v3 packs (both hero packs,
  all cached archives) load unchanged; v4 adds `results`.
- ✅ `session_result` table in header JSON (small table, no blob needed).
- ⬜ standings snapshots, per-lap mini-sector arrays (`laps.segments_sector_*` — still
  dropped at normalization; decide columnar encoding before adding).
- ⬜ Chunked/growable typed-array layout so the same format works for partial sessions (live).

### 1.4 Derived Metrics Engine (the actual data engineering) — ✅ CORE SHIPPED

New module `src/engine/metrics/` — pure functions over `SessionData`, unit-testable,
consumed by BOTH the dashboard and the theatre:

**Shipped & truth-checked** (`scripts/probe-metrics.ts` — ALL GATES PASS on both packs,
wet Brazil '24 + dry Monaco '24):
- `classifyLaps` — single source of truth for lap kinds (clean/no-time/lap1/pit-in/pit-out/sc/wet/outlier)
- tire degradation fits with **wet-compound context fitting** and **regime-break guard**
- consistency stats (median/stdev over clean laps only)
- paceVsField per-lap deltas; memoized registry + cursor reads (`degAt`, `paceDeltaAt`) for the One Time Cursor

| Metric family | What it computes | Feeds | Status |
|---|---|---|---|
| Tire degradation | per-stint pace curve, deg slope per compound, regime-break guard | strategy board, theatre tire glow intensity | ✅ |
| Consistency | lap-time stdev, outlier classification heuristics | dossier scatter plots | ✅ |
| Pace maps | per-lap delta to field best, percentile ranks | driver dossier | ✅ core |
| Undercut/overcut | pit-lap vs next-lap relative delta model (replaces the false claim with a real one) | moments engine v2 | ⬜ next |
| Gap dynamics | gap derivatives: closing rate, DRS-train detection | battle bridges truthfulness | ⬜ |
| Sector analysis | per-sector ranks, mini-sector heatmaps from `segments_sector_*` | track ribbon detail mode | ⬜ |
| Drama score v2 | existing moments + result context (`session_result` ingestion needed first) | race picker ranking | ⬜ |
| Track evolution | fastest-lap-per-lap-number curve (rubbering-in), wet/dry crossover points | weather overlays | ⬜ |

### 1.5 Circuit geometry cache (pre-cached track models) — ✅ SHIPPED *(runtime + script ready)*

Kill runtime track extrusion as the primary path; make it only the bootstrap.

- ✅ **Runtime resolution** — `src/data/circuitCache.ts`: static snapshot
  `/tracks/<key>.json` → fresh telemetry extrusion as fallback. Memoized per circuit.
  `Theatre.tsx` now resolves async through it (loading state handled, error panel kept).
- ✅ **Serialization layer** — `trackBuilder.ts` gained `CachedTrackGeometry`,
  `serializeTrackModel()` (provenance: source session key), `modelFromCached()`
  (rebuilds the spatial-hash lookups bit-compatibly with fresh builds).
- ✅ **Build script ready** — `scripts/build-tracks.ts` decodes every pack in
  `public/packs/`, extrudes, writes `public/tracks/<key>.json`. **Needs one terminal run
  when the owner is back:** `npx tsx scripts/build-tracks.ts`.
  (Plan's old `build-circuit.ts <key> [year]` per-circuit CLI superseded by this batch form.)
- ✅ **ALL-CIRCUIT BAKE** — `scripts/build-all-tracks.ts` enumerates every race
  2023→current year on OpenF1, picks the latest per circuit (26 distinct layouts incl. 2026's
  Madring & Kuala Lumpur), pulls one representative session each through the normal pipeline,
  extrudes, ships `public/tracks/<key>.json`. Run once; after it completes no session at any
  known circuit ever constructs geometry at runtime — extrusion stays purely as fallback for
  unknown/degraded sessions.
- ⬜ Year-versioning for circuit redesigns (`<key>.<year>.json` + nearest-year fallback).
  Partially self-solving: re-running the bake picks newer sessions automatically.

---

## Phase 2 — The Data Engineering Dashboard (TanStack + component kit)

> **⏳ EARLY SHIP:** the **Driver Dossier** landed ahead of the stack decision
> (`src/ui/Dossier.tsx` + styles) — ENGINEER-density replacement for the HUD, drawn
> straight off the metrics engine on canvas in house style. It is the first §0.7 proof:
> scatter, stint table and pace trace all read at RaceClock's cursor, zero scrubbers.
> TanStack wiring below remains as planned for the full lab.

### 2.1 Stack decisions

- **TanStack Query v5** — all API/cache access goes through query keys
  (`['session', key]`, `['metrics', sessionId, 'tireDeg', driver]`). Polling intervals and
  retry/backoff configured once; the pipeline-health panel reads the same cache. This also
  becomes the seam live will plug into (`refetchInterval` on live queries).
- **TanStack Table v8** — every tabular surface: lap logs, stint tables, race-control feed,
  results, standings. Column defs typed off `types.ts`; sorting/filtering/pinning free;
  virtualized rows below.
- **TanStack Virtual** — 60k-row lap logs scroll at 60fps.
- **Charts — Bklit** (confirmed): chart-component collection with Area, Bar, Heatmap,
  Sankey, Scatter, Gauge, Radar, **Live Line Chart**, Composed Chart and more. Maps almost
  1:1 onto the dashboard's viz needs: Live Line → rolling telemetry, Heatmap → sector
  heatmaps, Sankey → position-change flow, Scatter → lap-time outliers, Composed → gap
  evolution + pit-stop columns. Theme via `tokens.css` so charts stay porcelain.
- **Tables & state — TanStack (confirmed):**
  - **Query v5**: all API/cache access through query keys (`['session', key]`,
    `['metrics', sessionId, 'tireDeg', driver]`). Polling intervals + retry/backoff in one
    place; pipeline-health panel reads the same cache; `refetchInterval` becomes the live
    seam later.
  - **Table v8**: every tabular surface (lap logs, stints, race control, results,
    standings) — typed column defs off `types.ts`, virtualized below.
  - **Virtual v3**: 60k-row lap logs at 60fps.
- **Primitives:** any remaining chrome (Tabs, Dialogs, Toasts, Selects) adapts behind
  `src/ui-kit/`, styled by our tokens — Bklit covers charts only, not app shell.
- **ThreeUI** (`threeui.com` · `github.com/MengTo/threeui`, MIT) — R3F component library,
  same stack as the theatre. Aesthetic is dark/spatial ≠ porcelain, so: **reference, not
  dependency.** Mine its interaction patterns for 3D-space UI — radial gauge arcs, tick
  rings, shader progress arcs, needle damping physics — and re-express them as ink hairlines
  on porcelain where a surface genuinely wants an in-scene instrument (candidate: X-ray
  annotations, plinth-adjacent telemetry plaques). Revisit if a Phase 3 HUD-in-scene need
  materializes; canvas-drawn flat ink remains the default voice.

### 2.2 Dashboard surfaces (information-design first)

Routed under `/lab/*` from the existing Shell (density dial governs the theatre; the lab is
its engineer-mode sibling, sharing the same store):

| Surface | Contents | Primary viz |
|---|---|---|
| **Session Overview** | metadata, weather trace, flags timeline, drama curve, result table w/ DNF flags | canvas charts + Table |
| **Driver Dossier** | one driver, one session: stint table, tire-deg curves, lap-time scatter w/ outlier coloring, sector heatmap, top-speed trap ranks | small-multiples grid |
| **Head-to-Head** | 2–4 drivers: overlapped telemetry strips, gap-evolution chart, stint alignment | synchronized crosshair |
| **Strategy Board** | pit gantt (all cars), undercut-window model output, compound mix over race phases | gantt + band chart |
| **Race Control Log** | filterable RC messages (category/flag/sector/driver), linked timestamps that seek the theatre | Virtual table + deep-link |
| **Standings & Seasons** *(Jolpica)* | career grids, season progression 1950→now, points trajectories | bump/line charts |
| **Pipeline Health** | rate-budget gauge, cache hit rates, sync watermark ages | gauges |

Design rules: ink hairlines on porcelain ground, one red voice (existing tokens); every
number X-ray-explainable (reuse lineage pattern); empty/error states designed, not absent.
**All surfaces are clock-synced views of the one cursor (§0.7)** — none owns a scrubber.

### 2.3 The Catalogue — the built-in manual (dual-voice)

The user's requirement: *how to use the app* AND *what does each number mean — for a
normal person vs. a data engineer*. Answered with the museum metaphor's native pattern:
**every explanation exists twice**, as a visitor plaque and a curator's note.

```
 ? opens THE CATALOGUE ────────────────────────────────┐
 │                                                     │
 ├─ Quick Start        60 seconds, keyboard map       │
 ├─ What am I seeing?  annotated screenshot of the     │
 │                     diorama: every element named    │
 │                     (ribbon, bridge, tags, DNA…)    │
 ├─ Concepts A–Z       glossary where EVERY entry has  │
 │                     two voices, e.g.:               │
 │   UNDERCUT                                          │
 │   🏛 Visitor: "Pitting early to steal fresh tyres   │
 │      before your rival, forcing them to react."     │
 │   🔧 Curator: "Δt = t_out(B) − t_in(A). Positive    │
 │      when track-position loss < tyre-delta gain;    │
 │      our model flags it when Δlap < −0.8s vs        │
 │      rival's in-lap. See metrics/undercut.ts."      │
 ├─ Reading the data   per-surface guides ("how to     │
 │                     read the deg curve", "what the  │
 │                     scatter outliers mean")         │
 └─ Provenance         where every number comes from: │
                        OpenF1/Jolpica endpoints,      │
                        caveats, known gaps            │
```

- Same dual-register machinery as `narrate.ts` (broadcast vs engineer voices) and X-ray
  lineage notes — three expressions of ONE documentation system, not three hand-written sets.
- Context-aware: opening `?` from the Dossier lands on "Reading the data → Deg curves".
- Ships as static content module (`src/content/catalogue.ts`) so entries are type-checked
  against the metrics they describe — a concept that stops existing breaks the build.
- This is also the strongest portfolio artifact for the "teach what the pit wall sees"
  goal — make it public-facing prose quality.

---

## Phase 3 — Theatre upgrades (visualization you asked for)

| # | Upgrade | Notes |
|---|---------|-------|
| 3.1 | Cached-circuit ribbon (from 1.5) | shader unchanged; attributes precomputed — now for ALL 26 circuits via the bake |
| 3.2 | **Driver indicators**: billboard name tags (extend `tagTexture.ts`), position pips, compound chips on wheels (exists), leader crown, DRS-open pip, PIT/OUT markers, focus halo on selected driver | tag density governed by Density Dial: CINEMA = none unless focused, BROADCAST = leaders+battles, ENGINEER = all 20 |
| 3.3 | Click/hover raycast selection → focus driver; keyboard cycle `[ ]` through field | feeds FocusPanel + Director follow cam |
| 3.4 | Comparison ghost mode: 2–4 selected drivers rendered with offset ribbons/tinted trails, synced playheads | shares selection state with Head-to-Head dashboard panel |
| 3.5 | Moments Engine honesty pass: implement real undercut metric (1.4) or remove claim; narration hedges low-confidence moments | closes audit's weakest point |
| 3.6 | **Simulated Safety Car specimen** (pattern from `IAmTomShaw/f1-race-replay`, MIT) | we already know SC/VSC phases from the flag timeline; render an amber SC marker that rides the ribbon ahead of the leader during `phase==='SC'/'VSC'`, with pit-exit deploy / pit-entry return easing. The one "fake" entity on the diorama must be labeled as simulated in X-ray lineage notes. |

**Official turn numbers — intel & open decision** *(from studying f1-race-replay/FastF1)*:
official per-turn coordinates + numbering exist ONLY in F1 livetiming's TrackInfo stream
(FastF1's `get_circuit_info()`); OpenF1 does not mirror it and our other two APIs expose
corner counts only. Options: (a) stay telemetry-derived (current, legitimate), or
(b) build-time Python sidecar pulls TrackInfo once per circuit to correct T-numbers +
rotation. Livetiming is the gray-area source we ruled out for session data; a one-time
metadata pull is a softer call but still needs an owner decision. Until then, curvature
T-numbers are labeled as data-derived everywhere they appear.

## Phase 4 — Story modes (planning what to show, driven by data)

- **Race picker v2:** rank/archive sessions by computed drama score (1.4) — "most chaotic
  races of 2024", "best battles at Monza". Selection = race + participants preset.
- **Driver modes:** single-driver cinematic replay (Director follows one car, personal
  telemetry strips only) on any track; "lap record" view = fastest lap ever recorded at a
  circuit per year (OpenF1 laps + Jolpica history), played back as a ghost time trial vs
  the session winner's lap.
- **Year explorer:** pick a year → season calendar (Jolpica) → any session (OpenF1).
- **Toggleable lineups:** race → choose participating drivers → swap focus mid-race without
  reloads; presets persist (localStorage).

## Phase 5 — Live (unchanged goal, now cheaper)

Phase 1's watermark sync + growable pack format + Query polling make `LiveSource` mostly
composition:

- `LiveSource implements SessionSource`: poll loop with `date>` watermark per table;
  append into chunked channels; rolling `tMax`.
- Prefer OpenF1's **WebSocket/MQTT option** (supporter tier allows up to 10 concurrent
  streams; ~3 s latency) over polling once budget allows — abstract behind a
  `LiveTransport` interface so polling remains the free fallback.
- Progressive circuit: cached geometry makes day-one track available before telemetry forms.
- Connection UX: staleness badge, buffering states, reconnect sweep (reuse recovery-sweep
  logic).

---

## Suggested execution order

```
Phase 0 (verify+honesty)  →  1.5 circuits  →  1.1–1.3 platform  →  1.4 metrics
    →  Phase 2 (dashboard + ONE TIME CURSOR + Catalogue + Lobby/nav restructure)
    →  Phase 3 theatre  →  Phase 4 stories  →  Phase 5 live
(3 and 4 interleave with 2 once metrics exist — dashboard panels and theatre
 features consume the same metric functions. The §0.7 flow restructure lands early
 inside Phase 2 because every later surface assumes the clock-synced overlay model.)
```

## Decisions locked during planning

1. **Jolpica-F1** = primary history source (results/standings/schedules, 1950→now). ✅
2. **f1api.dev (F1 Connect)** = narrow enrichment feed for circuit metadata
   (lap records + holders, corner counts) attached to circuit cache artifacts. ✅
3. **Bklit** = chart layer of the dashboard. **TanStack Query/Table/Virtual** = data state,
   tables, virtualization. ✅
4. **UI direction** = "Museum Plinth" porcelain diorama — white space, centered track,
   orthographic near-isometric camera (§0.5). ✅

---

## 7. Inspiration scan — what the ecosystem taught us (mined 2026-08)

Sources: OpenF1 show-and-tell (prior scan in `PROJECT.md` §1 + audit's competitive table),
`github.com/topics/formula1`, plus the dataset repo evaluation (§8).

### Features adopted into this plan

| Idea | From | Where it lands |
|---|---|---|
| **TV-sync delay slider** — offset the replay clock ±N seconds so Join-as-Live matches the user's F1TV broadcast | `undercut-f1` (variable delay to sync to TV) | Phase 5 live + Join-as-Live transport now; trivial to add, huge QoL delight |
| **Simulated Safety Car entity** — SC rides the reference line ahead of the leader during track-status 4, with deploy/return easing from pit lane (F1 provides no SC GPS) | `IAmTomShaw/f1-race-replay` | Phase 3.6 theatre specimen; our flag timeline already supplies the phases |
| **Replay-synced telemetry** as a first-class mode | `F1ReplayTiming` | validates our whole premise; their gap = no interpretation layer — ours must stay ahead via Moments Engine |
| **Track-shape-from-telemetry derivation** independently validated | `f1-race-replay` derives its polyline from fastest-lap telemetry exactly as we do | confirms §1.5 approach is the community's working method, not a hack |
| **At-a-glance session cards** (compact, pretty, informative) | `formulaone-card`, `sportstimes/f1` calendar | Session Browser v2 card design in Phase 4 race picker |
| **Season calendar view polish** | `sportstimes/f1` | Phase 2 Standings & Seasons surface |
| **Live timing tower conventions** studied for live phase (delta coloring, penalty flags, lapped traffic marks) | `f1-dash` (slowlydev) — the strongest real-time TS dashboard in the space | Phase 5 |
| **Gap-genome differentiation check** | MultiViewer Race Trace (audit §competitive) | DNA strip stays differentiated only via moment-gravity + join-veil; do not let it become a bump chart alone |

### Studied and deliberately rejected

- **Hosted ML prediction services** (e.g., `Jared-Chan/f1ml` lineage): training/inference
  hosting is paid, latency-prone, and — worse for a portfolio piece — *unauditable*.
  Our thesis favors inspectable heuristics. See §8 for the free alternative.
- **Becoming a MultiViewer/F1TV client**: out of scope legally and strategically.
- **Home Assistant / TUI form factors**: wrong medium; but undercut-f1's delay concept and
  f1viewer's session-replay UX informed the transport design.

---

## 8. Dataset verdict — `toUpperCase78/formula1-datasets`

**Contents:** CSVs of race results (2013–2026), qualifying, sprint results, calendars,
drivers/teams tables, F1-game driver ratings, Driver-of-the-Day votes; Jupyter season
analyses. Static snapshots updated per-race. Attribution requested (reference/kudos).

**Your instinct is correct: no hosted ML predictor.** Training a model and serving
real-time inference means paid hosting, ops burden, cold-start latency — and it produces
the one thing this project refuses to have: an unauditable black box contradicting the
"show your working" thesis.

**But the dataset earns three free uses:**

| Use | How | Cost |
|---|---|---|
| **Backtest harness for the metrics engine** | Historical results CSVs = ground truth to validate undercut/strategy heuristics against ("model said pit lap 22; reality: lost 2 positions"). Ships as a test suite, not a feature. | zero |
| **Precomputed intelligence artifacts** | Build-time scripts crunch historical CSVs → static JSON baselines shipped with packs (win-probability per driver/circuit, typical pit windows, tire-deg norms). Theatre then tells stories like *"history gave Verstappen 31% from P17 — here's how he beat it."* All compute happens at build time on your machine. | zero hosting |
| **Dossier enrichment fields** | Game driver ratings + DOTD votes as small badges in Driver Dossier cards. | trivial |

Priority: **low-mid — after Phases 1–2**, since OpenF1+Jolpica already cover the core.
The backtest harness can slot into Phase 1.4 CI cheaply.

---

## 9. Rename candidates (pick one)

The name should carry the thesis — *interpretation, attention choreography, quality of
life* — and survive a hiring manager's Google search:

| Candidate | Story | Risk |
|---|---|---|
| **Pitboard** ⭐ | The pit board is literally the original "data presented better": team data interpreted down to two numbers a driver reads at 300 km/h. Contains "board" (dashboard heritage). Design hook: panels styled as pit boards. | Low collision found |
| **Purple Sector** | Purple = fastest sector in F1 timing. Instantly fluent to fans; implies excellence. | Conflicts with red-only accent palette unless purple becomes the "record moment" voice |
| **Gridwalk** | Pre-race exploration ritual; fits browsing/exploring framing. | Softer racing identity |
| **Flying Lap** | Evokes speed + replay; clean two words. | More generic |
| **Stint** | Single word, engineering-flavored (a run on one tire set). | May read obscure to non-fans |

Recommendation: **Pitboard**. Tagline potential: *"Your race, interpreted."*

---

## Appendix — Verified API facts (as of this plan)

**OpenF1** (`api.openf1.org/v1`) — 18 endpoints advertised; free tier 3 req/s + 30 req/min;
JSON or CSV; data from 2023→now; live ≈ 3 s behind; live window defined as 30 min before
session start → 30 min after end; WebSocket/MQTT available (supporters, ≤10 connections);
`session_result` confirmed returning points/DNF/DNS/DSQ/gap_to_leader. Unofficial —
non-commercial/educational terms.

**Jolpica-F1** (`api.jolpi.ca/ergast/…`) — Ergast-compatible successor, free, confirmed
live (served 2026 R12 standings during planning). Results, standings, schedules back to
1950. Complements OpenF1 (which has zero pre-2023 coverage).

**F1 Connect / f1api.dev** — free Ergast-style API, confirmed live (served full 2026
calendar during planning, including the new Madring circuit). Endpoints: seasons,
current season w/ schedules + winners + fast laps, drivers, teams, circuits. Unique
value: per-circuit `lapRecord` (+ holder/team/year), `corners`, `circuitLength`,
`firstParticipationYear`. Adopted as enrichment-only.

**Others worth knowing:** Formula 1's own `livetiming.formula1.com` static JSON feeds exist
but are unofficial/gray-area and undocumented — not recommended when OpenF1 covers the same
ground legitimately. FastF1/LiveF1 are Python libraries (useful as algorithm references,
not app data sources).
